# SPDX-License-Identifier: GPL-3.0-only
# MuseScore-Studio-CLA-applies
#
# MuseScore Studio
# Music Composition & Notation
#
# Copyright (C) 2021 MuseScore Limited and others
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License version 3 as
# published by the Free Software Foundation.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

# Local patch: this file was the last legacy-style module (declare_module +
# setup_module, both removed from the codebase). Rewritten in the current
# muse_create_module style, mirroring the sibling web/appjs module.

muse_create_module(appshell ALIAS muse::appshell)

target_sources(appshell PRIVATE
    appshellmodule.cpp
    appshellmodule.h
    iappshellconfiguration.h
    appshelltypes.h
    internal/applicationuiactions.cpp
    internal/applicationuiactions.h
    internal/appshellconfiguration.cpp
    internal/appshellconfiguration.h
    internal/applicationactioncontroller.cpp
    internal/applicationactioncontroller.h
    internal/istartupscenario.h
    internal/startupscenario.cpp
    internal/startupscenario.h
    view/appmenumodel.cpp
    view/appmenumodel.h
    view/notationpagemodel.cpp
    view/notationpagemodel.h
    view/notationstatusbarmodel.cpp
    view/notationstatusbarmodel.h
    view/navigableappmenumodel.cpp
    view/navigableappmenumodel.h
    appshell.qrc
    )

# The project-wide resource mechanism is qt_add_resources, not AUTORCC; the
# rewritten legacy module needs AUTORCC on this target to compile appshell.qrc
# (generates qInitResources_appshell, required by the final link).
set_target_properties(appshell PROPERTIES AUTORCC ON)

target_link_libraries(appshell PRIVATE
    muse::ui
    muse::uicomponents
    Qt::Quick
    )

# we use QKeyMapper to fix https://github.com/musescore/MuseScore/issues/10181
target_include_directories(appshell PRIVATE ${Qt6Gui_PRIVATE_INCLUDE_DIRS})