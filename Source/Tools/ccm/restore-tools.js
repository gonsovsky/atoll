var request = require("request")
const path = require('path');
const fs = require('fs');
const RestoreUnit = require('./restore/restore')

module.exports = {
    RestoreCoobsCommand(paths, coobName, coobVersion, overwrite) {
        return new Promise( async(resolve, reject) => {
            opts = {
                paths: paths,
                coobName: coobName,
                coobVersion: coobVersion,
                overwrite: overwrite
            }

            let restoreUnit = new RestoreUnit(opts)
            restoreUnit.restore()

        }).catch(err => ErrorAndRejectConsole(reject, errorMessage, ': failed to execute restore command', err));
    }
}