import config from "./config.js";
import qtLoad from "./qtloader.js";
import AudioDriver from "./audiodriver.js";

function setupInternalCallbacks(Module) {

    // Interactive
    Module.openFileDialog = function(callback) {
        console.log("[js] openFileDialog")
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = (e) => {
            const file = e.target.files[0];
            const fileName = file.name
            const reader = new FileReader();
            reader.onload = (e) => {
                const contents = e.target.result;
                const uint8View = new Uint8Array(contents);
                console.log("[js] openFileDialog fileName: ", fileName, ", contents: ", uint8View.length, ", [0]=", uint8View[0])
                callback(fileName, uint8View);
            };
            reader.readAsArrayBuffer(file); 
        };
        input.click();
    }
}

// Method enum, 0-based order from src/framework/audio/common/rpc/irpcchannel.h.
const RPC_METHOD = { 0:'Undefined',1:'EngineRunning',2:'EngineInit',3:'EngineDeinit',4:'EngineConfigChanged',5:'SetOutputSpec',6:'AddSequence',7:'RemoveSequence',8:'GetSequenceIdList',9:'RemoveTrack',10:'RemoveAllTracks',11:'GetTrackIdList',12:'GetTrackName',13:'AddTrackWithPlaybackData',14:'AddTrackWithIODevice',15:'AddAuxTrack',16:'TrackAdded',17:'TrackRemoved',18:'GetAvailableInputResources',19:'GetAvailableSoundPresets',20:'GetInputParams',21:'SetInputParams',22:'GetInputProcessingProgress',23:'InputProcessingProgress',24:'ProcessInput',25:'ClearCache',26:'ClearSources',27:'PrepareToPlay',28:'Play',29:'Seek',30:'Stop',31:'Pause',32:'Resume',33:'SetDuration',34:'SetLoop',35:'ResetLoop',36:'GetPlaybackStatus',37:'GetPlaybackPosition',38:'GetOutputParams',39:'SetOutputParams',40:'GetMasterOutputParams',41:'SetMasterOutputParams',42:'ClearMasterOutputParams',43:'OutputParamsChanged',44:'MasterOutputParamsChanged',45:'GetSignalChanges',46:'GetMasterSignalChanges',47:'GetAvailableOutputResources',48:'SaveSoundTrack',49:'AbortSavingAllSoundTracks',50:'GetSaveSoundTrackProgress',51:'ClearAllFx',52:'LoadSoundFonts',53:'AddSoundFont',54:'AddSoundFontData',55:'TransportEventReceived' };

function decodeRpcMethod(u8) {
    // msgpack: [1 (msgId), callId, method, type, data...]
    let i = 0;
    const readInt = () => {
        const b = u8[i];
        if (b < 0x80) { i++; return b; }
        if (b === 0xcc) { i++; const v = u8[i]; i++; return v; }
        if (b === 0xcd) { i++; const v = (u8[i] << 8) | u8[i+1]; i += 2; return v; }
        if (b === 0xce) { i++; const v = (u8[i] * 0x1000000) + (u8[i+1] << 16) + (u8[i+2] << 8) + u8[i+3]; i += 4; return v; }
        if (b === 0xcf) { i++; const v = Number((BigInt(u8[i]) << 56n) | (BigInt(u8[i+1]) << 48n) | (BigInt(u8[i+2]) << 40n) | (BigInt(u8[i+3]) << 32n) | (BigInt(u8[i+4]) << 24n) | (BigInt(u8[i+5]) << 16n) | (BigInt(u8[i+6]) << 8n) | BigInt(u8[i+7])); i += 8; return v; }
        if (b === 0xd0) { i++; const v = u8[i]; i++; return v - 256; }
        if (b === 0xd1) { i++; const v = (u8[i] << 8) | u8[i+1]; i += 2; return v - 65536; }
        i++; return -1;
    };
    const msgId = readInt();
    const callId = readInt();
    const method = readInt();
    const type = readInt();
    // data payload: first few msgpack values (seqId / params). Only decode up
    // to the first few tokens for diagnostics.
    let dataTail = [];
    let di = i;
    for (let k = 0; k < 4 && di < u8.length; k++) {
        const save = i; i = di;
        try { const v = readInt(); dataTail.push(v); di = i; } catch (e) { i = save; break; }
    }
    return { msgId, callId, method, type, name: RPC_METHOD[method] || ('m' + method), typeName: type === 0 ? 'Undef' : type === 1 ? 'Notify' : type === 2 ? 'Req' : type === 3 ? 'Resp' : 'Stream', dataTail };
}

function setupRpc(Module)
{
    // Main <=> Worker 
    // port1 - main
    // port2 - worker
    Module.main_worker_rpcChannel = new MessageChannel();

    Module.main_worker_rpcSend = function(data) {
        // [rpc-trace] main -> engine
        try { const d = decodeRpcMethod(new Uint8Array(data.buffer || data)); console.log('[rpc-trace] main->engine', JSON.stringify(d)); } catch (e) { console.log('[rpc-trace] main->engine (undecoded)', data && data.length); }
        Module.main_worker_rpcChannel.port1.postMessage(data)
    }

    Module.main_worker_rpcListen = function(data) {} // will be overridden

    Module.main_worker_rpcChannel.port1.onmessage = function(event) {
        // [rpc-trace] engine -> main
        try { const d = decodeRpcMethod(new Uint8Array(event.data.buffer || event.data)); console.log('[rpc-trace] engine->main', JSON.stringify(d)); } catch (e) { console.log('[rpc-trace] engine->main (undecoded)', event.data && event.data.length); }
        Module.main_worker_rpcListen(event.data)
    };

    // Worker <=> Driver (processor)
    // port1 - driver
    // port2 - worker
    Module.driver_worker_rpcChannel = new MessageChannel();
}

async function setupDriver(Module) 
{
    Module.driver = AudioDriver;

    AudioDriver.onInited = function() {
        console.log("driver on inited add sound font")

        if (Module.isNeedStartAudio) {
            Module._startAudioProcessing()
        }

        Module.ccall('addSoundFont', '', ['string'], [Module.soundFont]);
    }

    if (config.MUSE_MODULE_AUDIO_WORKER == "ON") {
        await AudioDriver.setup(Module.config, Module.driver_worker_rpcChannel.port1);
    } else {
        await AudioDriver.setup(Module.config, Module.main_worker_rpcChannel.port2);
    }

}

async function setupWorker(Module)
{
    // Initialize the worker.
    Module.worker = new Worker("distr/audioworker.js")

    var museAudioUrl = new URL("MuseAudio.js", window.location) + "";

    Module.worker.onmessage = function(event) {
        if (event.data.type == "WORKER_INITED") {
            Module.ccall('addSoundFont', '', ['string'], [Module.soundFont]);
        }
    }

    Module.worker.postMessage({
    type: 'INITIALIZE_WORKER',
    mainPort: Module.main_worker_rpcChannel.port2,
    driverPort: Module.driver_worker_rpcChannel.port2,
    options: {
        museAudioUrl: museAudioUrl
    }
    }, [Module.main_worker_rpcChannel.port2, Module.driver_worker_rpcChannel.port2]);
}

const MuImpl = {

    Module: {},

    loadModule: async function(opt) {

        console.info("STEP 0: Begin load main module")

        this.Module = {
            config: config, // static configuration

            qt: {
                onLoaded: opt.onLoaded,
                onExit: opt.onExit,
                entryFunction: window.MuseScoreStudio_entry, // from MuseScoreStudio.js
                containerElements: [opt.screen],
            },

            soundFont: opt.soundFont,

            // called from cpp
            onStartApp: this._onStartApp.bind(this),

            // forward wasm-side diagnostics (qWarning/qDebug on stderr) to the
            // page so the last action before a crash is visible without devtools
            printErr: (...args) => {
                const line = args.join(' ');
                console.error('[wasm]', line);
                if (typeof opt.onLog === 'function') opt.onLog(line);
            },
        }

        setupRpc(this.Module);
        console.info("STEP 0.1: End setupRpc")
        setupInternalCallbacks(this.Module);
        console.info("STEP 0.2: End setupInternalCallbacks")

        this.Module = await qtLoad(this.Module);
        console.info("STEP 0.3: End load main module")

        return this.Module;
    },

    _onStartApp: async function() {
        console.info("STEP 1: Begin on onStartApp")
        await setupDriver(this.Module);
        console.info("STEP 1.1: End setupDriver")

        if (config.MUSE_MODULE_AUDIO_WORKER == "ON") {
            await setupWorker(this.Module);
            console.info("STEP 1.2: End setupWorker")
        }
    },

    loadScoreFile: async function(file) {
        if (!file) {
            return
        }

        const buffer = await file.arrayBuffer();
        this.loadScoreData(new Uint8Array(buffer)) 
    },

    loadScoreData: function(data) {
        const ptr = this.Module._malloc(data.length);
        this.Module.HEAPU8.set(data, ptr);
        this.Module._load(ptr, data.length);
        this.Module._free(ptr);
    },

    startAudioProcessing: async function() {
        if (this.Module.driver.inited) {
            this.Module._startAudioProcessing()
        } else {
            console.log("driver not inited, start audio will be later")
            this.Module.isNeedStartAudio = true;
        }
    }
}

export default MuImpl;
