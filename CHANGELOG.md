# Changelog

### 1.1.0
* Override tab panel background color
  - This implements an internal color method for use with the browser window. This should hopefully get rid of the white flashes and follows the same method used in bug 1488384, which overrides the background color of the tab panel (anonymous content that is a *child of the `browser` element).
* Fix conflicts with uBO element picker

### 1.0.9
* Fix missing domWindow variable

### 1.0.8
* Exclude uBlock Origin's element picker from scope application
  - This also adds a hidden preference to adjust the delay before checking if the current page is uBlock Origin's element picker overlay (`extensions.swarth.compatibility.ubo_epicker_check_delay`)
* Mark as compatible with Pale Moon 32

### 1.0.7
* Don't launch preferences window as modal from the toolbar button

### 1.0.6
* Guard against document shells that are either null or does not have any children
* Implement support for Pale Moon 31 and restore support for Basilisk

### 1.0.5
* Ensure all cached stylesheets are cleared upon receiving invalidation event

### 1.0.4
* Reset scope if location change was caused by (push/pop/replace)State

### 1.0.3
* Ensure that the method ID is an integer when setting the method to be used for a particular scope in the scopes dialog
* Implement migration for scope configuration
  - Move scope information to `scopes` property and include a `version` property in the configuration file
  - Handle previous configurations that contain `string` method IDs and convert them if necessary

### 1.0.2
* Update install manifest

### 1.0.1
* Include workaround for missing thumbnails and article images on Ars Technica
* Add hidden preference for always retaining the background image when using the stylesheet processor (`extensions.swarth.processor.retain_background_image`)

### 1.0.0
* Initial release
