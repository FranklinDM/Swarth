/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["StylesheetManager", "ScopeConfig"];

const { classes: Cc, interfaces: Ci, results: Cr, utils: Cu } = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyModuleGetter(
    this,
    "OS",
    "resource://gre/modules/osfile.jsm"
);
XPCOMUtils.defineLazyModuleGetter(
    this,
    "JSONFile",
    "resource://gre/modules/JSONFile.jsm"
);
XPCOMUtils.defineLazyModuleGetter(
    this,
    "StylesheetColorProcessor",
    "chrome://swarth/content/modules/StylesheetProcessor.jsm",
);
XPCOMUtils.defineLazyModuleGetter(
    this,
    "ColorUtils",
    "chrome://swarth/content/modules/ColorUtils.jsm"
);
XPCOMUtils.defineLazyModuleGetter(
    ColorUtils,
    "parseCSSColor",
    "chrome://swarth/content/modules/ColorParser.jsm"
);
XPCOMUtils.defineLazyGetter(this, "ScopeConfig", function () {
    let configPath = OS.Path.join(OS.Constants.Path.profileDir, "swarth-scope.json");
    return new JSONFile({ path: configPath });
});

var ScopeConfigTemporary = {};

var updatedWindows = new WeakSet();

var StylesheetManager = {
    kMethodDefault: -1,
    kMethodDisabled: 0,
    kMethodCSSProcessor: 1,
    kMethodCSSSimple: 2,
    kMethodColorInversion: 3,

    windowState: new WeakMap(),

    init: function () {
        StylesheetManagerInternal.init();
    },

    apply: function (aWindow, aMethod, aOptions, aInvalidateCache = false) {
        var invalidateCache = aInvalidateCache ||
                (this.windowState.has(aWindow) && !updatedWindows.has(aWindow));
        if (this.windowState.has(aWindow)) {
            let state = this.windowState.get(aWindow);
            let isSameDocument = (aWindow.document == state.document.get());
            if (isSameDocument && !state.markers) {
                StylesheetManagerInternal._setMarkers(aWindow);
                state.markers = true;
            }
            if (isSameDocument && state.method == aMethod && !invalidateCache) {
                return false;
            } else {
                this.remove(aWindow);
            }
        }

        let processorInstance = null;
        let sheetURIs = [];
        switch (aMethod) {
            case this.kMethodCSSProcessor:
                aOptions.important_for_toplevel = (aWindow.top === aWindow.self) ? '!important' : '';
                sheetURIs = [
                    StylesheetManagerInternal.getStylesheet(
                        kSheetBaseKey, aOptions, invalidateCache),
                    StylesheetManagerInternal.getStylesheet(
                        kSheetProcessorKey, aOptions, invalidateCache)
                ];
                processorInstance = new StylesheetColorProcessor(aWindow, aOptions);
                processorInstance.load_into_window();
                break;
            case this.kMethodCSSSimple:
                sheetURIs = [
                    StylesheetManagerInternal.getStylesheet(
                        kSheetBaseKey, aOptions, invalidateCache),
                    StylesheetManagerInternal.getStylesheet(
                        kSheetSimpleKey, aOptions, invalidateCache)
                ];
                break;
            default:
            case this.kMethodColorInversion:
                sheetURIs = [
                    StylesheetManagerInternal.getStylesheet(
                        kSheetInvertKey, aOptions, invalidateCache)
                ];
                break;
        }

        for (let i = 0; i < sheetURIs.length; i++) {
            let currentURI = sheetURIs[i];
            let windowUtils = aWindow
                              .QueryInterface(Ci.nsIInterfaceRequestor)
                              .getInterface(Ci.nsIDOMWindowUtils);
            windowUtils.loadSheet(currentURI, windowUtils.USER_SHEET);
        }

        this.windowState.set(
            aWindow,
            {
                method: aMethod,
                stylesheets: sheetURIs,
                processor: processorInstance,
                document: Cu.getWeakReference(aWindow.document),
                markers: false
            }
        );
        updatedWindows.add(aWindow);

        return true;
    },
    
    remove: function (aWindow, aFastUnload = false) {
        if (!this.windowState.has(aWindow)) {
            return false;
        }
        
        try {
            var currentDocument = this.windowState.get(aWindow);
            let windowUtils = aWindow.QueryInterface(Ci.nsIInterfaceRequestor)
                                     .getInterface(Ci.nsIDOMWindowUtils);
            let sheetURIs = currentDocument.stylesheets;
            for (let i = 0; i < sheetURIs.length; i++) {
                let currentURI = sheetURIs[i];
                windowUtils.removeSheet(currentURI, windowUtils.USER_SHEET);
            }
            if (currentDocument.processor != null) {
                currentDocument.processor.unload_from_window(aFastUnload);
            }
        } catch (e) {
        }

        this.windowState.delete(aWindow);
        updatedWindows.delete(aWindow);

        return true;
    },

    update: function (aTarget, aOptions) {
        var invalidateCache =
            ("invalidate" in aTarget) ? aTarget.invalidate : false;
        if (aTarget.method == this.kMethodDefault) {
            aTarget.method = aOptions.default_method;
        }
        if (aOptions.enabled && aOptions.color_enabled) {
            var scopeEnabled = (aTarget.method != this.kMethodDisabled);
            if (aTarget.method == this.kMethodColorInversion && !aTarget.isTopLevel) {
                scopeEnabled = false;
            }
            if (scopeEnabled) {
                return this.apply(
                    aTarget.window,
                    aTarget.method,
                    aOptions,
                    invalidateCache
                );
            }
        }
        return this.remove(aTarget.window);
    },

    updateDocShell: function (aTarget, aOptions) {
        var invalidateCache =
            ("invalidate" in aTarget) ? aTarget.invalidate : false;
        var childDocShells = StylesheetManagerInternal._getChildDocShells(aTarget.docShell);
        for (let i = 0; i < childDocShells.length; i++) {
            let docShell = childDocShells[i];
            this.update(
                {
                    window: docShell.DOMWindow,
                    method: aTarget.method,
                    isTopLevel: docShell.isTopLevel,
                    invalidate: invalidateCache
                },
                aOptions
            );
        }
    },

    getMethod: function (aURI, aPrivateContext) {
        if (aPrivateContext && aURI in ScopeConfigTemporary) {
            return ScopeConfigTemporary[aURI];
        }
        if (aURI in ScopeConfig.data) {
            return ScopeConfig.data[aURI];
        }
        return this.kMethodDefault;
    },

    updateScope: function (aURI, aMethod, aPrivateContext) {
        let targetConfig = aPrivateContext ? ScopeConfigTemporary : ScopeConfig.data;
        if (aMethod == this.kMethodDefault) {
            delete targetConfig[aURI];
        } else {
            targetConfig[aURI] = aMethod;
        }
    },

    setMethod: function (aURI, aMethod, aPrivateContext) {
        if (Array.isArray(aURI)) {
            for (let i = 0; i < aURI.length; i++) {
                this.updateScope(aURI[i], aMethod, aPrivateContext);
            }
        } else {
            this.updateScope(aURI, aMethod, aPrivateContext);
        }
        Services.obs.notifyObservers(null, "swm-state-changed", "scope-updated");
    },
};

Object.freeze(StylesheetManager);

XPCOMUtils.defineLazyModuleGetter(
    this,
    "NetUtil",
    "resource://gre/modules/NetUtil.jsm"
);

const kSheetBaseKey   = "base";
const kSheetSimpleKey = "simple";
const kSheetInvertKey = "invert";
const kSheetProcessorKey = "processor";

const kCharset = "UTF-8";

const kMarkerClassPrefix = 'sw-';
const kSelectorClassMap = {
    'html > body > div#outerContainer > div#mainContainer > div#viewerContainer > div#viewer.pdfViewer': 'is-pdf-viewer',
    'html > head > link[href="resource://gre/res/TopLevelImageDocument.css"]': 'is-top-level-image-document',
};

const kObserverTopics = [
    "quit-application",
    "last-pb-context-exited",
    "swm-state-changed"
];

var CachedStylesheets = new Map();

var StylesheetManagerInternal = {
    _initialized: false,

    init: function () {
        if (this._initialized) {
            return;
        }
        ScopeConfig.ensureDataReady();
        for (let i = 0; i < kObserverTopics.length; i++) {
            Services.obs.addObserver(this, kObserverTopics[i], false);
        }
        this._initialized = true;
    },
    
    uninit: function () {
        ScopeConfig.saveSoon();
        ScopeConfigTemporary = {};
        for (let i = 0; i < kObserverTopics.length; i++) {
            Services.obs.removeObserver(this, kObserverTopics[i]);
        }
    },

    observe: function (aSubject, aTopic, aData) {
        switch (aTopic) {
            case "quit-application":
                this.uninit();
                break;
            case "last-pb-context-exited":
                ScopeConfigTemporary = {};
                break;
            case "swm-state-changed":
                if (aData == "invalidate") {
                    updatedWindows = new WeakSet();
                }
                break;
        }
    },

    _setMarkers: function (aWindow) {
        for (let selector in kSelectorClassMap) {
            if (aWindow.document.querySelector(selector)) {
                aWindow.document.documentElement.classList.toggle(
                    kMarkerClassPrefix + kSelectorClassMap[selector],
                    true
                );
            }
        }
    },

    _getChildDocShells: function (parentDocShell) {
        let docShellsEnum = parentDocShell.getDocShellEnumerator(
            Ci.nsIDocShellTreeItem.typeAll,
            Ci.nsIDocShell.ENUMERATE_FORWARDS
        );
        let docShells = [];
        while (docShellsEnum.hasMoreElements()) {
            let docShell = docShellsEnum.getNext();
            docShell.QueryInterface(Ci.nsIInterfaceRequestor)
                    .getInterface(Ci.nsIWebProgress);
            docShells.push(docShell);
        }
        return docShells;
    },

    _readURIToString: function (aURI) {
        let channel = NetUtil.newChannel({
            uri: NetUtil.newURI(aURI, kCharset),
            loadUsingSystemPrincipal: true
        });
        let stream = channel.open2();

        let count = stream.available();
        let data = NetUtil.readInputStreamToString(stream, count, { charset: kCharset });

        stream.close();
        
        return data;
    },

    _stripNumberSign: function (aString) {
        if (aString.indexOf && aString.indexOf('#') === 0) {
            return aString.slice(1);
        }
        return aString;
    },

    _appendLuminance: function (aOptions) {
        let backgroundLuminance = ColorUtils.relative_luminance(
                ColorUtils.parseCSSColor(aOptions.default_background_color));
        let foregroundLuminance = ColorUtils.relative_luminance(
                ColorUtils.parseCSSColor(aOptions.default_foreground_color));
        let isDarkBackground = backgroundLuminance < foregroundLuminance;
        aOptions.if_dark_background_start = isDarkBackground ? "": "/*";
        aOptions.if_dark_background_end = isDarkBackground ? "" : "*/";
        aOptions.if_light_background_start = isDarkBackground ? "/*" : "";
        aOptions.if_light_background_end = isDarkBackground ? "*/" : '';
    },

    _getEncodedStylesheetURI: function (aSheetText, aOptions) {
        if (aOptions) {
            this._appendLuminance(aOptions);
            for (let key in aOptions) {
                aSheetText = aSheetText.replace(
                    new RegExp("{" + key + "}", "g"),
                    this._stripNumberSign(aOptions[key])
                );
            }
        }

        let sheetData = "data:text/css;charset=" + kCharset + ";base64," + btoa(aSheetText);
        let sheetURI = NetUtil.newURI(sheetData, kCharset);
        return sheetURI;
    },

    getStylesheet: function (aSheetKey, aOptions, aInvalidateCache) {
        if (aInvalidateCache || !CachedStylesheets.has(aSheetKey)) {
            let sheetURI = "";
            switch (aSheetKey) {
                case kSheetInvertKey:
                    sheetURI = "chrome://swarth/content/stylesheets/invert.css";
                    break;
                case kSheetBaseKey:
                    sheetURI = "chrome://swarth/content/stylesheets/base.css";
                    break;
                case kSheetSimpleKey:
                    sheetURI = "chrome://swarth/content/stylesheets/simple.css";
                    break;
                case kSheetProcessorKey:
                    sheetURI = "chrome://swarth/content/stylesheets/stylesheet-processor.css";
                    break;
                default:
                    return false;
            }

            let sheetText = this._readURIToString(sheetURI);
            let sheetURIEncoded = this._getEncodedStylesheetURI(sheetText, aOptions);
            CachedStylesheets.set(aSheetKey, sheetURIEncoded);

            return sheetURIEncoded;
        }

        return CachedStylesheets.get(aSheetKey);
    },
};
