#include "guiapp.h"

#include <QApplication>
#include <QQmlApplicationEngine>
#include <QQuickWindow>
#include <QQmlContext>
#include <QTimer>
#include <QPluginLoader>

// Local patch (wasm only): see qmlstaticplugins.cpp. The wasm linker's
// --gc-sections drops the file-scope QQmlModuleRegistration objects, and the
// generated qmldir files no longer carry plugin/classname lines (patched
// Qt6QmlMacros.cmake), so the QML engine can only resolve Muse.*/MuseScore.*
// imports through the module registry populated here. These functions register
// both the module URIs and their types; the engine must not also load the
// static plugin (hence the missing plugin lines) or the namespace collision
// "Namespace '...' has already been used for type registration" occurs.
extern "C" void museRegisterAllQmlModules();

#include "modularity/imodulesetup.h"
#include "modularity/ioc.h"
#include "thirdparty/kors_logger/src/log_base.h"
#include <QDebug>
#include "ui/iuiengine.h"
#include "ui/graphicsapiprovider.h"

#include "async/processevents.h"

#include "muse_framework_config.h"
#include "app_config.h"

#ifdef MUE_ENABLE_SPLASHSCREEN
#include "appshell/widgets/splashscreen/splashscreen.h"
#else
namespace mu::appshell {
class SplashScreen
{
public:
    void close() {}
};
}
#endif

#ifdef QT_CONCURRENT_SUPPORTED
#include <QThreadPool>
#endif

#include "log.h"

using namespace muse;
using namespace muse::ui;
using namespace mu;
using namespace mu::app;
using namespace mu::appshell;

static int m_lastId = 0;

// TEMP debug: cache module pointers/names/vtables from the registerResources loop so
// the registerExports loop can detect heap corruption without vtable calls.
static const void* g_modPtrCache[64] = {};
static std::string g_modNameCache[64];
static const void* g_vptrCache[64] = {};

// TEMP debug: pointer/vptr of module [16] (braille) for cross-TU corruption probes.
static const void* g_dbgBrailleObj = nullptr;
static const void* g_dbgBrailleVptr = nullptr;

extern "C" void dbgCheckBrailleAt(const char* tag)
{
    if (!g_dbgBrailleObj) {
        return;
    }
    const void* vp = *reinterpret_cast<const void* const*>(g_dbgBrailleObj);
    qInfo() << "[SETUP]   braille-check" << tag << vp << (vp == g_dbgBrailleVptr ? "SAME" : "DIFF") << "cached" << g_dbgBrailleVptr;
}

GuiApp::GuiApp(const CmdOptions& options, const modularity::ContextPtr& ctx)
    : muse::BaseApplication(ctx), m_options(options)
{
}

void GuiApp::addModule(muse::modularity::IModuleSetup* module)
{
    m_modules.push_back(module);
}

void GuiApp::setup()
{
    qInfo() << "[SETUP] begin";
    const CmdOptions& options = m_options;

    IApplication::RunMode runMode = options.runMode;
    IF_ASSERT_FAILED(runMode == IApplication::RunMode::GuiApp) {
        return;
    }

    setRunMode(runMode);

    // ====================================================
    // Setup modules: Resources, Exports, Imports, UiTypes
    // ====================================================
    qInfo() << "[SETUP] globalModule setApplication";
    m_globalModule.setApplication(shared_from_this());
    m_globalModule.registerResources();
    qInfo() << "[SETUP] globalModule registerExports";
    m_globalModule.registerExports();
    m_globalModule.registerUiTypes();

    qInfo() << "[SETUP] modules registerResources n=" << m_modules.size();
    int mi = 0;
    for (modularity::IModuleSetup* m : m_modules) {
        qInfo() << "[SETUP]   [" << mi << "] registerResources" << QString::fromStdString(m->moduleName());
        g_modPtrCache[mi] = m;
        g_modNameCache[mi] = m->moduleName();
        g_vptrCache[mi] = *reinterpret_cast<const void* const*>(m);
        if (mi == 16) {
            g_dbgBrailleObj = m;
            g_dbgBrailleVptr = g_vptrCache[16];
        }
        m->setApplication(shared_from_this());
        m->registerResources();
        if (mi >= 16) {
            const void* bv = *reinterpret_cast<const void* const*>(m_modules[16]);
            qInfo() << "[SETUP]   resources-after[" << mi << "] braille-vptr" << bv << (bv == g_vptrCache[16] ? "SAME" : "DIFF");
        }
        mi++;
    }

    qInfo() << "[SETUP] modules registerExports n=" << m_modules.size();
    mi = 0;
    for (modularity::IModuleSetup* m : m_modules) {
        const void* bv = *reinterpret_cast<const void* const*>(m_modules[16]);
        qInfo() << "[SETUP]   export-before[" << mi << "] braille-vptr" << bv << (bv == g_vptrCache[16] ? "SAME" : "DIFF");
        qInfo() << "[SETUP]   [" << mi << "] NEXT" << (void*)m;
        const char* nm = (m == g_modPtrCache[mi]) ? g_modNameCache[mi].c_str() : "PTR-CHANGED";
        qInfo() << "[SETUP]   [" << mi << "] name " << nm << (m == g_modPtrCache[mi] ? "SAME" : "DIFF");
        const void* vp = *reinterpret_cast<const void* const*>(m);
        qInfo() << "[SETUP]   [" << mi << "] vptr " << vp << (vp == g_vptrCache[mi] ? "SAME" : "DIFF") << "cached" << g_vptrCache[mi];
        qInfo() << "[SETUP]   [" << mi << "] CALLING";
        m->registerExports();
        qInfo() << "[SETUP]   [" << mi << "] DONE";
        const void* av = *reinterpret_cast<const void* const*>(m_modules[16]);
        qInfo() << "[SETUP]   export-after[" << mi << "] braille-vptr" << av << (av == g_vptrCache[16] ? "SAME" : "DIFF");
        mi++;
    }
    qInfo() << "[SETUP] modules registerExports COMPLETE n=" << m_modules.size();

#ifndef MUSE_MULTICONTEXT_WIP
    qInfo() << "[SETUP] contextSetups registerExports";
    modularity::ContextPtr ctx = std::make_shared<modularity::Context>();
    ctx->id = 0;
    std::vector<muse::modularity::IContextSetup*>& csetups = contextSetups(ctx);
    int ci = 0;
    for (modularity::IContextSetup* s : csetups) {
        qInfo() << "[SETUP]   ctx[" << ci << "] registerExports";
        s->registerExports();
        ci++;
    }
#endif

    qInfo() << "[SETUP] global resolveImports/registerApi";
    m_globalModule.resolveImports();
    m_globalModule.registerApi();
    qInfo() << "[SETUP] modules resolveImports/registerApi";
    mi = 0;
    for (modularity::IModuleSetup* m : m_modules) {
        qInfo() << "[SETUP]   [" << mi++ << "] uiTypes/imports/api" << QString::fromStdString(m->moduleName());
        m->registerUiTypes();
        m->resolveImports();
        m->registerApi();
    }

#ifndef MUSE_MULTICONTEXT_WIP
    for (modularity::IContextSetup* s : csetups) {
        s->resolveImports();
    }
#endif

    // ====================================================
    // Setup modules: apply the command line options
    // ====================================================
    qInfo() << "[SETUP] applyCommandLineOptions";
    applyCommandLineOptions(options);

    // ====================================================
    // Setup modules: onPreInit
    // ====================================================
    qInfo() << "[SETUP] global onPreInit";
    m_globalModule.onPreInit(runMode);
    qInfo() << "[SETUP] modules onPreInit";
    int pi = 0;
    for (modularity::IModuleSetup* m : m_modules) {
        qInfo() << "[SETUP]   [" << pi++ << "] onPreInit" << QString::fromStdString(m->moduleName());
        m->onPreInit(runMode);
    }

#ifndef MUSE_MULTICONTEXT_WIP
    for (modularity::IContextSetup* s : csetups) {
        s->onPreInit(runMode);
    }
#endif

    // Process all pending events (see IpcSocket::onReadyRead())
    // so that we can use windowCount() as early as possible
    muse::async::processMessages();

#ifdef MUE_ENABLE_SPLASHSCREEN
    if (multiwindowsProvider()->windowCount() == 1) { // first
        m_splashScreen = new SplashScreen(SplashScreen::Default);
    } else {
        const project::ProjectFile& file = startupScenario()->startupScoreFile();
        if (file.isValid()) {
            if (file.hasDisplayName()) {
                m_splashScreen = new SplashScreen(SplashScreen::ForNewInstance, false, file.displayName(true /* includingExtension */));
            } else {
                m_splashScreen = new SplashScreen(SplashScreen::ForNewInstance, false);
            }
        } else if (startupScenario()->isStartWithNewFileAsSecondaryInstance()) {
            m_splashScreen = new SplashScreen(SplashScreen::ForNewInstance, true);
        } else {
            m_splashScreen = new SplashScreen(SplashScreen::Default);
        }
    }

    if (m_splashScreen) {
        m_splashScreen->show();
    }
#endif

    // ====================================================
    // Setup modules: onInit
    // ====================================================
    qInfo() << "[SETUP] global onInit";
    m_globalModule.onInit(runMode);
    qInfo() << "[SETUP] modules onInit";
    int oi = 0;
    for (modularity::IModuleSetup* m : m_modules) {
        qInfo() << "[SETUP]   [" << oi++ << "] onInit" << QString::fromStdString(m->moduleName());
        m->onInit(runMode);
    }

#ifndef MUSE_MULTICONTEXT_WIP
    for (modularity::IContextSetup* s : csetups) {
        s->onInit(runMode);
    }
#endif

    // ====================================================
    // Setup modules: onAllInited
    // ====================================================
    m_globalModule.onAllInited(runMode);
    for (modularity::IModuleSetup* m : m_modules) {
        m->onAllInited(runMode);
    }

#ifndef MUSE_MULTICONTEXT_WIP
    for (modularity::IContextSetup* s : csetups) {
        s->onAllInited(runMode);
    }
#endif

    // ====================================================
    // Setup modules: onStartApp (on next event loop)
    // ====================================================
    QMetaObject::invokeMethod(qApp, [this]() {
        m_globalModule.onStartApp();
        for (modularity::IModuleSetup* m : m_modules) {
            m->onStartApp();
        }
    }, Qt::QueuedConnection);

    // ====================================================
    // Setup modules: onDelayedInit
    // ====================================================
    QTimer::singleShot(5000, [this]() {
        m_globalModule.onDelayedInit();
        for (modularity::IModuleSetup* m : m_modules) {
            m->onDelayedInit();
        }
    });

    // ====================================================
    // Run
    // ====================================================

    // ====================================================
    // Setup Qml Engine
    // ====================================================
    //! Needs to be set because we use transparent windows for PopupView.
    //! Needs to be called before any QQuickWindows are shown.
    QQuickWindow::setDefaultAlphaBuffer(true);

    //! NOTE Adjust GS Api
    //! We can hide this algorithm in GSApiProvider,
    //! but it is intentionally left here to illustrate what is happening.
    {
        GraphicsApiProvider* gApiProvider = new GraphicsApiProvider(BaseApplication::appVersion());

        GraphicsApi required = gApiProvider->requiredGraphicsApi();
        if (required != GraphicsApi::Default) {
            LOGI() << "Setting required graphics api: " << GraphicsApiProvider::apiName(required);
            GraphicsApiProvider::setGraphicsApi(required);
        }

        LOGI() << "Using graphics api: " << GraphicsApiProvider::graphicsApiName();
        LOGI() << "Gui platform: " << QGuiApplication::platformName();

        if (GraphicsApiProvider::graphicsApi() == GraphicsApi::Software) {
            gApiProvider->destroy();
        } else {
            LOGI() << "Detecting problems with graphics api";
            gApiProvider->listen([this, gApiProvider, required](bool res) {
                if (res) {
                    LOGI() << "No problems detected with graphics api";
                    gApiProvider->setGraphicsApiStatus(required, GraphicsApiProvider::Status::Checked);
                } else {
                    GraphicsApi next = gApiProvider->switchToNextGraphicsApi(required);
                    LOGE() << "Detected problems with graphics api; switching from " << GraphicsApiProvider::apiName(required)
                           << " to " << GraphicsApiProvider::apiName(next);

                    this->restart();
                }
                gApiProvider->destroy();
            });
        }
    }

    QQmlApplicationEngine* engine = muse::modularity::globalIoc()->resolve<muse::ui::IUiEngine>("app")->qmlAppEngine();

    // TEMP debug (wasm QML registration): dump static plugin registry and a couple
    // of registered QML types to see whether QQmlModuleRegistration / Q_IMPORT_PLUGIN
    // initializers actually ran in this binary.
    {
        const QList<QStaticPlugin>& staticPlugins = QPluginLoader::staticPlugins();
        qInfo() << "[QMLDBG] staticPlugins count=" << staticPlugins.size();
        int qmlPlugins = 0;
        for (const QStaticPlugin& sp : staticPlugins) {
            const QJsonObject md = sp.metaData();
            const QString iid = md.value("IID").toString();
            if (iid.contains("QQmlEngineExtensionInterface")) {
                qmlPlugins++;
                qInfo() << "[QMLDBG]   qml plugin" << md.value("className").toString();
            }
        }
        qInfo() << "[QMLDBG] qml-plugin count=" << qmlPlugins;
    }

    // Local patch (wasm only): register every MuseScore QML module's URI and
    // types up front. The generated qmldir files have no plugin/classname lines
    // (see Qt6QmlMacros.cmake patch), so this registry is the only way the
    // engine can resolve Muse.*/MuseScore.* imports. Must run before any QML
    // load; after this the engine imports hit the registry directly and never
    // try to load the static plugins (avoiding the namespace collision).
    qInfo() << "[QMLDBG] calling museRegisterAllQmlModules...";
    museRegisterAllQmlModules();
    qInfo() << "[QMLDBG] museRegisterAllQmlModules done";

    QObject::connect(engine, &QQmlApplicationEngine::objectCreated, qApp, [](QObject* obj, const QUrl&) {
        QQuickWindow* w = dynamic_cast<QQuickWindow*>(obj);
        //! NOTE It is important that there is a connection to this signal with an error,
        //! otherwise the default action will be performed - displaying a message and terminating.
        //! We will not be able to switch to another backend.
        QObject::connect(w, &QQuickWindow::sceneGraphError, qApp, [](QQuickWindow::SceneGraphError, const QString& msg) {
            LOGE() << "scene graph error: " << msg;
        });
    }, Qt::DirectConnection);
}

std::vector<muse::modularity::IContextSetup*>& GuiApp::contextSetups(const muse::modularity::ContextPtr& ctx)
{
    for (Context& c : m_contexts) {
        if (c.ctx->id == ctx->id) {
            return c.setups;
        }
    }

    m_contexts.emplace_back();

    Context& ref = m_contexts.back();
    ref.ctx = ctx;

    modularity::IContextSetup* global = m_globalModule.newContext(ctx);
    if (global) {
        ref.setups.push_back(global);
    }

    for (modularity::IModuleSetup* m : m_modules) {
        modularity::IContextSetup* s = m->newContext(ctx);
        if (s) {
            ref.setups.push_back(s);
        }
    }

    return ref.setups;
}

int GuiApp::contextCount() const
{
    return static_cast<int>(m_contexts.size());
}

std::vector<muse::modularity::ContextPtr> GuiApp::contexts() const
{
    std::vector<muse::modularity::ContextPtr> ctxs;
    ctxs.reserve(m_contexts.size());
    for (const Context& c : m_contexts) {
        ctxs.push_back(c.ctx);
    }
    return ctxs;
}

muse::modularity::ContextPtr GuiApp::setupNewContext()
{
    //! NOTE
    //! We're currently in a transitional state from a single global context to multiple contexts.
    //! Therefore, this code will be improved; not everything is yet complete,
    //! for example, there's no way to delete (close) a specific context.
    //! Probably the context initialization needs to be moved to the base class of the app.

#ifndef MUSE_MULTICONTEXT_WIP
    static bool once = false;
    IF_ASSERT_FAILED(!once) {
        return nullptr;
    }
    once = true;
#endif

    modularity::ContextPtr ctx = std::make_shared<modularity::Context>();
    ++m_lastId;
#ifdef MUSE_MULTICONTEXT_WIP
    ctx->id = m_lastId;
#else
    // only global
    ctx->id = 0;
#endif

    const CmdOptions& options = m_options;
    IApplication::RunMode runMode = options.runMode;
    IF_ASSERT_FAILED(runMode == IApplication::RunMode::GuiApp) {
        return nullptr;
    }

    LOGI() << "New context created with id: " << ctx->id;

    // Setup
#ifdef MUSE_MULTICONTEXT_WIP
    std::vector<muse::modularity::IContextSetup*>& csetups = contextSetups(ctx);

    for (modularity::IContextSetup* s : csetups) {
        s->registerExports();
    }

    for (modularity::IContextSetup* s : csetups) {
        s->resolveImports();
    }

    for (modularity::IContextSetup* s : csetups) {
        s->onPreInit(runMode);
    }

    for (modularity::IContextSetup* s : csetups) {
        s->onInit(runMode);
    }

    for (modularity::IContextSetup* s : csetups) {
        s->onAllInited(runMode);
    }
#endif

    // Load main window
#if defined(Q_OS_MAC)
    QString platform = "mac";
#elif defined(Q_OS_WIN)
    QString platform = "win";
#else
    QString platform = "linux";
#endif

    QQmlApplicationEngine* engine = muse::modularity::globalIoc()->resolve<muse::ui::IUiEngine>("app")->qmlAppEngine();

    // Local patch: the wasm build embeds the web appshell QML under the "/"
    // prefix (src/web/appshell/appshell.qrc -> :/qml/Main.qml); the desktop
    // path below is not compiled into the wasm binary.
#if defined(Q_OS_WASM)
    QString path = QString(":/qml/Main.qml");
#else
    QString path = QString(":/qt/qml/MuseScore/AppShell/platform/%1/Main.qml").arg(platform);
#endif
    QQmlComponent component = QQmlComponent(engine, path);
    if (!component.isReady()) {
        LOGE() << "Failed to load main qml file, err: " << component.errorString();
        return nullptr;
    }

    QQmlContext* qmlCtx = new QQmlContext(engine);
    qmlCtx->setObjectName(QString("QQmlContext: %1").arg(ctx ? ctx->id : 0));
    QmlIoCContext* iocCtx = new QmlIoCContext(qmlCtx);
    iocCtx->ctx = ctx;
    qmlCtx->setContextProperty("ioc_context", QVariant::fromValue(iocCtx));

    QObject* obj = component.create(qmlCtx);
    if (!obj) {
        LOGE() << "failed Qml load\n";
        QCoreApplication::exit(-1);
        return nullptr;
    }

    // Local patch (wasm debug): step markers to locate the post-QML crash point
    // ("RuntimeError: null function or function signature mismatch").
    LOGI() << "[QMLDBG] component.create OK, obj=" << static_cast<void*>(obj);

    startupScenario()->runOnSplashScreen();
    LOGI() << "[QMLDBG] runOnSplashScreen OK";

    if (m_splashScreen) {
        m_splashScreen->close();
        delete m_splashScreen;
        m_splashScreen = nullptr;
    }

    // The main window must be shown at this point so KDDockWidgets can read its size correctly
    // and scale all sizes properly. https://github.com/musescore/MuseScore/issues/21148
    // but before that, let's make the window transparent,
    // otherwise the empty window frame will be visible
    // https://github.com/musescore/MuseScore/issues/29630
    // Transparency will be removed after the page loads.
    m_window = dynamic_cast<QQuickWindow*>(obj);
    LOGI() << "[QMLDBG] window cast OK";
    // Local patch (wasm): stock code parks the window at 1% opacity until the
    // page finishes loading (desktop WindowContent.qml restores opacity in
    // onPageLoaded). The web appshell has no such restore and our web
    // runOnSplashScreen() is a no-op (HTML splash), so the window would stay
    // invisible forever -> white page. Keep it fully opaque in this build.
    m_window->setOpacity(1.0);
    LOGI() << "[QMLDBG] setOpacity OK";
    m_window->setVisible(true);
    LOGI() << "[QMLDBG] setVisible OK";

    startupScenario()->runAfterSplashScreen();
    LOGI() << "[QMLDBG] runAfterSplashScreen OK";

    return ctx;
}

void GuiApp::finish()
{
    {
        TRACEFUNC;

        // Wait Thread Poll
    #ifdef QT_CONCURRENT_SUPPORTED
        QThreadPool* globalThreadPool = QThreadPool::globalInstance();
        if (globalThreadPool) {
            LOGI() << "activeThreadCount: " << globalThreadPool->activeThreadCount();
            globalThreadPool->waitForDone();
        }
    #endif

        if (m_window) {
            m_window->setVisible(false);
        }

        // Engine quit
        ioc()->resolve<muse::ui::IUiEngine>("app")->quit();

        // Deinit
        async::processMessages();

        for (modularity::IModuleSetup* m : m_modules) {
            m->onDeinit();
        }
        m_globalModule.onDeinit();

        for (modularity::IModuleSetup* m : m_modules) {
            m->onDestroy();
        }
        m_globalModule.onDestroy();

        // Delete contexts
        for (auto& c : m_contexts) {
            qDeleteAll(c.setups);
        }

        // Delete modules
        qDeleteAll(m_modules);
        m_modules.clear();

        removeIoC();

        BaseApplication::finish();
    }

    PROFILER_PRINT;
}

void GuiApp::applyCommandLineOptions(const CmdOptions& options)
{
    if (options.app.revertToFactorySettings) {
        appshellConfiguration()->revertToFactorySettings(options.app.revertToFactorySettings.value());
    }

    if (guitarProConfiguration()) {
        if (options.guitarPro.experimental) {
            guitarProConfiguration()->setExperimental(true);
        }

        if (options.guitarPro.linkedTabStaffCreated) {
            guitarProConfiguration()->setLinkedTabStaffCreated(true);
        }
    }

    startupScenario()->setStartupType(options.startup.type);

    if (options.startup.scoreUrl.has_value()) {
        project::ProjectFile file { options.startup.scoreUrl.value() };

        if (options.startup.scoreDisplayNameOverride.has_value()) {
            file.displayNameOverride = options.startup.scoreDisplayNameOverride.value();
        }

        startupScenario()->setStartupScoreFile(file);
    }

    if (options.app.loggerLevel) {
        m_globalModule.setLoggerLevel(options.app.loggerLevel.value());
    }
}
