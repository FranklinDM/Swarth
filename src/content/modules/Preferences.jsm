/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["Preferences"];

const { classes: Cc, interfaces: Ci, results: Cr, utils: Cu } = Components;

Cu.import("resource://gre/modules/Services.jsm");

const kPrefersColorSchemePref = "browser.display.prefers_color_scheme";
const kUIColorSchemePref = "ui.color_scheme";
const kQuitObserverTopic = "quit-application";
const kEnabledPref = "enabled";

var Preferences = {
    branch: Services.prefs.getBranch("extensions.swarth."),
    
    _initialized: false,

    init: function () {
        if (this._initialized) {
            return;
        }
        Services.obs.addObserver(this, kQuitObserverTopic, false);
        this.branch.addObserver("", this, false);
        this._initialized = true;
    },
    
    uninit: function () {
        Services.obs.removeObserver(this, kQuitObserverTopic);
        this.branch.removeObserver("", this);
    },

    _onPreferenceChanged: function (aPrefName) {
        let data = "";

        switch (aPrefName) {
            case "enabled":
            case "default_method":
            case "follow_preferred_color_scheme":
            case "keep_private_browsing_scope":
                break;
            default:
                data = "invalidate";
                break;
        }

        Services.obs.notifyObservers(null, "swm-state-changed", data);
    },

    observe: function (aSubject, aTopic, aData) {
        switch (aTopic) {
            case "nsPref:changed":
                this._onPreferenceChanged(aData);
                break;
            case kQuitObserverTopic:
                this.uninit();
                break;
        }
    },

    _getEnabledBasedOnColorScheme: function (aDefault) {
        let platformColorScheme = Services.prefs.getIntPref(kUIColorSchemePref, -1);
        let browserColorScheme = Services.prefs.getIntPref(kPrefersColorSchemePref, -1);

        switch (browserColorScheme) {
            case 0:
                return aDefault;
            case 1:
                return false;
            case 2:
                return true;
            case 3:
            default:
                // Use platform color scheme if the preference is set to 3
                // or if the preference is absent from the application
                break;
        }
        
        if (platformColorScheme != -1) {
            switch (platformColorScheme) {
                case 0:
                    return aDefault;
                case 1:
                    return false;
                case 2:
                    return true;
                case 3:
                    // TODO: unimplemented
                    break;
                default:
                    break;
            }
        }
        
        return aDefault;
    },

    getAll: function () {
        let childList = this.branch.getChildList("", {});
        let prefs = {};
        for (let i = 0; i < childList.length; i++) {
            let prefName = childList[i];
            let prefType = this.branch.getPrefType(prefName);
            let prefValue = null;
            switch (prefType) {
                case Services.prefs.PREF_STRING:
                    prefValue = this.branch.getCharPref(prefName);
                    break;
                case Services.prefs.PREF_INT:
                    prefValue = this.branch.getIntPref(prefName);
                    break;
                case Services.prefs.PREF_BOOL:
                    prefValue = this.branch.getBoolPref(prefName);
                    break;
                default:
                case Services.prefs.PREF_INVALID:
                    break;
            }
            prefs[prefName] = prefValue;
        }

        prefs.color_enabled = this.enabled;
        if (prefs.follow_preferred_color_scheme) {
            prefs.color_enabled = this._getEnabledBasedOnColorScheme(this.enabled);
        }

        return prefs;
    },
    
    reset: function () {
        let childList = this.branch.getChildList("", {});
        for (let i = 0; i < childList.length; i++) {
            let prefName = childList[i];
            this.branch.clearUserPref(prefName);
        }
    },

    toggleEnabled: function () {
        this.enabled = !this.enabled;
    },

    get enabled () {
        return this.branch.getBoolPref(kEnabledPref);
    },

    set enabled (aValue) {
        this.branch.setBoolPref(kEnabledPref, aValue);
    },
};
