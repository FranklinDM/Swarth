/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["ColorUtils"];

this.ColorUtils = {};

               // red, yellow, green, cyan, blue, magenta
const max_bg_L = [50, 25, 30, 25, 60, 45];
const min_fg_L = [80, 40, 45, 40, 85, 75];

this.ColorUtils.get_acceptable_range = function (H) {
    H = H % 360; // cycle it
    let n = Math.floor( H / 60);
    let dark_start = max_bg_L[(n) % 6];
    let dark_end = max_bg_L[(n + 1) % 6];
    let light_start = min_fg_L[(n) % 6];
    let light_end = min_fg_L[(n + 1) % 6];

    let pi_multiplier = (H % 60) / 60;
    let start_angle = 3*Math.PI/2;
    let angle = start_angle + (Math.PI)*pi_multiplier;
    let multiplier = (Math.sin(angle) + 1) / 2;
    return [
        Math.round(
            dark_start + multiplier*(dark_end - dark_start)
        ),
        Math.round(
            light_start + multiplier*(light_end - light_start)
        )
    ];
};

this.ColorUtils.RGB_to_HSL = function(rgb_array) {
    let R = (1.0 * rgb_array[0]) / 255;
    let G = (1.0 * rgb_array[1]) / 255;
    let B = (1.0 * rgb_array[2]) / 255;
    let MAX = Math.max(R, G, B);
    let MIN = Math.min(R, G, B);
    let H;
    if (MAX == MIN)
        // H has no effect, set it to 0 to prevent undefined;
        H = 0;
    else if (MAX == R && G >= B)
        H = 60.0 * (G - B)/(MAX - MIN);
    else if (MAX == R && G < B)
        H = 60.0 * (G - B)/(MAX - MIN) + 360;
    else if (MAX == G)
        H = 60.0 * (B - R)/(MAX - MIN) + 120;
    else if (MAX == B)
        H = 60.0 * (R - G)/(MAX - MIN) + 240;
    let L = (MAX + MIN)/2;
    let S = (MAX - MIN)/(1 - Math.abs(1 - (MAX + MIN)));
    if (Number.isNaN(S)) // isNaN is too slow
        S = 0;
    return [H, S * 100, L * 100];
};

this.ColorUtils.RGB_to_HSV = function (R_, G_, B_) {
    let R = 1.0 * R_ / 255;
    let G = 1.0 * G_ / 255;
    let B = 1.0 * B_ / 255;

    let MAX = Math.max(R, G, B);
    let MIN = Math.min(R, G, B);

    let H;
    let S;
    let V = MAX;

    /*H*/
    if (MAX == MIN)
        H = 0;
    else if (MAX == R && G >= B)
        H = 60 * ( (G - B) / (MAX - MIN) );
    else if (MAX == R && G < B)
        H = 60 * ( (G - B) / (MAX - MIN) ) + 360;
    else if (MAX == G)
        H = 60 * ( (B - R) / (MAX - MIN) ) + 120;
    else if (MAX == B)
        H = 60 * ( (R - G) / (MAX - MIN) ) + 240;

    /*S*/
    if (MAX == 0)
        S = 0;
    else
        S = 1 - (MIN / MAX);

    return {
        'H': H,
        'S': S,
        'V': V
    };
};

this.ColorUtils.HSV_to_RGB = function (H_, S_, V_) {
    let H = H_ * 1.0;
    let S = S_ * 100.0;
    let V = V_ * 100.0;

    let H_i = Math.floor(H / 60);
    let V_min = ((100 - S) * V) / 100;
    let a = ( V - V_min ) * ( (H % 60) * 1.0 / 60);
    let V_inc = V_min + a;
    let V_dec = V - a;
    let R, G, B;

    if (H_i == 0) {
        R = V;
        G = V_inc;
        B = V_min;
    }
    else if (H_i == 1) {
        R = V_dec;
        G = V;
        B = V_min;
    }
    else if (H_i == 2) {
        R = V_min;
        G = V;
        B = V_inc;
    }
    else if (H_i == 3) {
        R = V_min;
        G = V_dec;
        B = V;
    }
    else if (H_i == 4) {
        R = V_inc;
        G = V_min;
        B = V;
    }
    else if (H_i == 5) {
        R = V;
        G = V_min;
        B = V_dec;
    }
    return {
        'R': Math.floor(R * 2.55),
        'G': Math.floor(G * 2.55),
        'B': Math.floor(B * 2.55)
    };
};

this.ColorUtils.lighten_or_darken_color = function(rgba_color_array, darken_not_lighten, options){
    let hsl_color_array = ColorUtils.RGB_to_HSL(rgba_color_array);
    let H = hsl_color_array[0];
    let S = hsl_color_array[1];
    let L = hsl_color_array[2];
    let alpha = rgba_color_array[3];
    let range = ColorUtils.get_acceptable_range(H);
    let new_L;
    if (S < 20) {
        if (darken_not_lighten) {
            return 'rgba(' + [
                options.default_dark_color[0],
                options.default_dark_color[1],
                options.default_dark_color[2],
                alpha
            ].join(', ') + ')';
        } else {
            return 'rgba(' + [
                    options.default_light_color[0],
                    options.default_light_color[1],
                    options.default_light_color[2],
                    alpha
                ].join(', ') + ')';
        }
    }
    if (darken_not_lighten) {
        if (L <= range[0])
            new_L = L;
        else if (L >= 100 - range[0])
            new_L = 100 - L;
        else
            new_L = range[0];
    } else {
        if (L >= range[1])
            new_L = L;
        else if (L <= 100 - range[1])
            new_L = 100 - L;
        else
            new_L = range[1];
    }
    return 'hsla('+
            H + ', '+
            S + '%, '+
            new_L + '%, '+
            alpha + ')'
};

this.ColorUtils.lighten_color = function(rgba_color_array, options){
    return ColorUtils.lighten_or_darken_color(rgba_color_array, false, options);
};

this.ColorUtils.darken_color = function (rgba_color_array, options) {
    return ColorUtils.lighten_or_darken_color(rgba_color_array, true, options);
};

this.ColorUtils.relative_luminance = function (color_array) {
    let R = (1.0 * color_array[0]) / 255;
    let G = (1.0 * color_array[1]) / 255;
    let B = (1.0 * color_array[2]) / 255;
    // https://en.wikipedia.org/wiki/Luma_(video)#Luma_versus_relative_luminance
    // coefficients defined by Rec. 601
    return 0.299 * R + 0.587 * G + 0.114 * B
};
