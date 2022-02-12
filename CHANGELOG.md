# Changelog

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
