// cli-internal is used from npm source; scan the repository's hoisted plugin directory.
const path = require('node:path');
const { PluginPlatform } = require('@aws-amplify/amplify-cli-core');
const { readPluginsJsonFile, writePluginsJsonFile } = require('@aws-amplify/cli-internal/lib/plugin-helpers/access-plugins-file');
const platform = readPluginsJsonFile() || new PluginPlatform();
const directory = path.resolve('node_modules');
if (!platform.pluginDirectories.includes(directory)) platform.pluginDirectories.push(directory);
writePluginsJsonFile(platform);
