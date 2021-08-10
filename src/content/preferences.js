/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { classes: Cc, interfaces: Ci, results: Cr, utils: Cu } = Components;

Cu.import("chrome://swarth/content/modules/Preferences.jsm");

var gPreferencesDialog = {
    _initialized: false,

    init: function () {
        if (this._initialized) {
            return;
        }

        let textboxes = document.getElementsByTagName("textbox");
        for (let i = 0; i < textboxes.length; i++) {
            let textboxElement = textboxes[i];
            this.onTextboxChanged(textboxElement);
        }

        this._initialized = true;
    },

    onDialogResetAll: function () {
        Preferences.reset();
    },

    onColorChanged: function (aTarget) {
        let textboxElement = document.getElementById(aTarget.id + "Textbox");
        textboxElement.value = aTarget.value;
    },

    onTextboxChanged: function (aTarget) {
        let inputId = aTarget.id.substring(0, aTarget.id.length - 7);
        let inputElement = document.getElementById(inputId);
        // TODO: Support other color formats
        if (aTarget.value.search(new RegExp('^#[\\da-fA-F]{6}$')) !== 0) {
            let prefName = aTarget.getAttribute("preference").substring(5);
            aTarget.value = Preferences.branch.getCharPref(prefName);
        }
        inputElement.value = aTarget.value;
    },
    
    openScopes: function () {
        document.documentElement.openWindow(
            "Swarth:Scopes",
            "chrome://swarth/content/scopes.xul",
            null
        );
    },
};
