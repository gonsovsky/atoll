var request = require("request")
const path = require('path');
const fs = require('fs');
const fsx = require('fs-extra');
const DevTool = require('../devtool/devtool')

class RestoreUnit {

    constructor(opts) {
        this.opts = opts
        this.svcUrl = "http://coobs.sftconsult.synology.me:5000/"
        this.devtool = new DevTool(opts.paths);
    }

    async restore() {
        let body = await this.downloadPage(this.svcUrl)

        let name = this.opts.coobName
        let latestVersion = this.coobLatestVersion(name, body)

        let useVersion = latestVersion;
        if (!(this.opts.coobVersion == null || this.opts.coobVersion == ""))
            useVersion = this.opts.coobVersion;

        await this.restoreCoob(name, useVersion)

        let props = await this.coobProps(name);
        let references = props.references;

        for (var p in references) {
            let coob = references[p]
            await this.restoreCoob(coob.id, coob.version)
        }
        console.log('All coobs are restored.')
    }

    process(json) {
        console.log(json)
    }

    restoreCoob(coobName, coobVersion) {
        return new Promise((resolve, reject) => {
            var url = this.coobUrl(coobName, coobVersion)
            var filename = this.coobDest(coobName, coobVersion)
            var folder = this.coobDestFolder(coobName)
            console.log(`Downloading ${url}...`)
            fsx.ensureDirSync(folder)
            fsx.emptyDirSync(folder)
            request(url).pipe(fs.createWriteStream(filename)).on('close',
                () => {
                    this.devtool.unzip(filename, this.coobDestFolder(coobName))
                        .then(() => {
                            fs.unlinkSync(filename)
                            resolve();
                        })
                        .catch(err => {
                            throw `Failed to restore coob ${coobName}: ${err}`;
                        });
                }
            );
        });
    }

    coobLatestVersion(coobName, body) {

        function versionCompare(v1, v2, options) {
            var lexicographical = options && options.lexicographical,
                zeroExtend = options && options.zeroExtend,
                v1parts = v1.split('.'),
                v2parts = v2.split('.');

            function isValidPart(x) {
                return (lexicographical ? /^\d+[A-Za-z]*$/ : /^\d+$/).test(x);
            }

            if (!v1parts.every(isValidPart) || !v2parts.every(isValidPart)) {
                return NaN;
            }

            if (zeroExtend) {
                while (v1parts.length < v2parts.length) v1parts.push("0");
                while (v2parts.length < v1parts.length) v2parts.push("0");
            }

            if (!lexicographical) {
                v1parts = v1parts.map(Number);
                v2parts = v2parts.map(Number);
            }

            for (var i = 0; i < v1parts.length; ++i) {
                if (v2parts.length == i) {
                    return 1;
                }

                if (v1parts[i] == v2parts[i]) {
                    continue;
                } else if (v1parts[i] > v2parts[i]) {
                    return 1;
                } else {
                    return -1;
                }
            }

            if (v1parts.length != v2parts.length) {
                return -1;
            }

            return 0;
        }

        var me = this;
        var x = Object.keys(body);
        x = x.filter((e) => {
            return me.coobName(e) == coobName
        });
        x = x.map(function (e) {
            return me.coobVersion(e)
        });
        x.sort((a, b) => versionCompare(a, b));
        return x[x.length - 1];
    }

    coobProps(coobName) {
        let propsFile = this.coobPropsFile(coobName)
        let props = this.devtool.CoobProps(propsFile)
        return props
    };

    coobName(coobName) {
        let x = coobName.split('.');
        x.pop();
        coobName = x.join('.')
        let res = coobName.replace(this.coobVersion(coobName), '')
        res = res.slice(0, -1);
        return res;
    }

    coobVersion(coobName) {
        function is_numeric(str) {
            return /^\d+$/.test(str);
        }

        let x = coobName.split('.');
        x = x.filter((e) => {
            return is_numeric(e)
        });
        var res = x.join('.')
        return res;
    }

    coobUrl(coobName, coobVersion) {
        return this.svcUrl + coobName + "." + coobVersion + ".coob"
    }

    coobDest(coobName, coobVersion) {
        return path.join(this.opts.paths.coobsDir, coobName + "." + coobVersion + ".zip")
    }

    coobDestFolder(coobName) {
        return path.join(this.opts.paths.coobsDir, coobName)
    }

    coobPropsFile(coobName) {
        return path.join(this.opts.paths.coobsDir, coobName, 'coob.props')
    }

    downloadPage(url) {
        let options = {json: true};
        return new Promise((resolve, reject) => {
            request(url, options, (error, response, body) => {
                if (error) reject(error);
                if (response.statusCode != 200) {
                    reject('Invalid status code <' + response.statusCode + '>');
                }
                resolve(body);
            });
        });
    }
}

module.exports = RestoreUnit