var request = require("request")
const path = require('path');
const fs = require('fs');
const RestoreUnit = require('./restore/restore')
const { ErrorAndReject, ErrorAndRejectConsole, InfoAndResolve, InfoAndResolveConsole, SafeIniString, IsValidVersion } = require('./helpers');


module.exports = {
    RestoreCoobsCommand(paths, coobName, coobVersion, overwrite) {
        return new Promise(  (resolve, reject) => {

            if (coobName == null || coobName == "")
            {
                return ErrorAndRejectConsole(reject,  'Failed to execute restore command. CoobName argument is not defined.')
            }

            opts = {
                paths: paths,
                coobName: coobName,
                coobVersion: coobVersion,
                overwrite: overwrite
            }

            let restoreUnit = new RestoreUnit(opts)
            restoreUnit.restore().then(resolve())
                .catch(err =>
                    ErrorAndRejectConsole(reject, errorMessage, 'Failed to execute restore command', err));
        }).catch(err =>
            ErrorAndRejectConsole(reject, errorMessage, 'Failed to execute restore command', err)
        );
    }
}