//@ts-check
const fs = require('fs-extra');
const winston = require('winston');
const path = require('path');
const os = require('os');
const { exec, spawn } = require('child_process');

/**
 *     @typedef {Object} SpawnOptions 
        @prop {string} [cwd]
        @prop {*} [env]
        @prop {*} [stdio]
        @prop {boolean} [detached]
        @prop {number} [uid]
        @prop {number} [gid]
        @prop {boolean|string} [shell]
        @prop {boolean} [windowsVerbatimArguments]
        @prop {boolean} [windowsHide]
    }
 */

/**
* Выполнить проверку корректности заданной строки как значения компонента версии.
* @param {string} s - строка для проверки.
*/
function IsValidVersionComponent(s) {

    const l = s.length;
    if (l < 1) return false;

    let c = s.charAt(0);

    if (l < 2)
        return !(c < '0' || c > '9');

    if (c < '1' || c > '9') return false;

    for (let i = 1; i < l; i++) {

        c = s[i];
        if (c < '0' || c > '9') return false;
    }

    const n = parseInt(s);
    if (n > 2147483647) return false;

    return true;
}

module.exports = {


    /**
     * Выполнить проверку корректности заданной строки как значения версии.
     * @param {string} s - строка для проверки.
     * @returns {boolean} - признак успеха.
     */
    IsValidVersion(s) {

        const parts = s.split('.', 5);
        const length = parts.length;

        if (length < 2 || length > 4) return false;

        if (!IsValidVersionComponent(parts[0]) || !IsValidVersionComponent(parts[1])) return false;

        if (length < 3) return true;

        if (!IsValidVersionComponent(parts[2])) return false;

        if (length < 4) return true;

        return IsValidVersionComponent(parts[3]);
    },

    /**
     * Выполнить коррекцию заданной строки для использования в ini-файлах.
     * @param {string} val - строка.
     * @returns {string}
     */
    SafeIniString(val) {

        // Пустые значения.
        if (val === null || val === undefined || val.length < 1) return '';
        
        // Значение из 1 символа.
        if (val.length < 2) { 
    
            switch(val) { 
                case ';': return '";"';
                case '"': return '"\\""';
                case ' ': return '" "';
                default: return val;
            }
        }
    
        // Условие на непограничные значения, которые нужно брать в кавычки.
        if (val.charAt(0) === ' ' || val.slice(-1) === ' ' || val.includes(';') || val.includes('"'))
            return `"${val.replace('"', '\\"')}"`;
    
        return val;
    },

    /**
     * Выбрать свободное имя объекта файловой системы.
     * @param {string} dirPath - путь до папки, в которой необходимо выбрать свободное имя для объекта.
     * @param {string} prefix - префикс имени объекта.
     * @param {string} [suffix] - суффикс имени объекта.
     */
    ChooseFreeFsName(dirPath, prefix, suffix) {

        suffix = '' || suffix;

        return new Promise((resolve, reject) => {

            const errorMessage = `Failed to choose free file name for dir [${dirPath}]`;

            fs.readdir(dirPath).then((entries) => {

                let maxNumber = null;
                let hasExact = false;

                for (let entry of entries) {

                    if (entry.startsWith(prefix) && entry.endsWith(suffix)) {

                        const numstr = entry.substring(prefix.length, entry.length - suffix.length);

                        if (numstr.length < 1) {
                            hasExact = true;
                            continue;
                        }

                        if (numstr[0] !== '_') continue;

                        const num = parseInt(numstr.substring(1));

                        if (num === NaN) continue;

                        if (!maxNumber || maxNumber < num)
                            maxNumber = num;
                    }
                }

                if (!hasExact)
                    return resolve(path.join(dirPath, prefix + suffix));

                return resolve(path.join(dirPath, prefix + '_' + (++maxNumber).toString() + suffix));

            }).catch((err) => {

                winston.error(err);
                return reject(new Error(`${errorMessage}: failed to enumerate dir: ${err.message}`));

            });

        });
    },

    /**
     * Сгенерировать случайную строку.
     * @returns {string}
     */
    RandomString() {
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    },


    /**
     * Получить строку, соответствующую числу с минимальным заданным количеством позиций.
     * @param {number} num - число.
     * @param {number} digits - минимальное количество позиций.
     * @returns {string}
     */
    FN(num, digits) {

        return num.toLocaleString('en-US', { minimumIntegerDigits: digits, useGrouping: false })

    },

    /**
     * Обертка над стандартным child_process.spawn для использования по модели обещаний.
     * @param {string} command - команда для запуска
     * @param {string[]} [args] - аргументы команды
     * @param {SpawnOptions} [options]
     * @returns {Promise<{code?: number, signal?: string, stdout?: string, stderr?: string}>}
     */
    Spawn(command, args, options) {

        const spawnLine = command + ' ' + args.join(' ');

        return new Promise((resolve, reject) => {

            winston.info(`Spawning child process with line: ${spawnLine}...`);

            const child = spawn(command, args, options);

            // Самостоятельно буферизуем вывод процесса.
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', data => { stdout += data; });
            child.stderr.on('data', data => { stderr += data; });

            // Реджектим только при невозможности создать процесс.
            child.on('error', err => this.ErrorAndReject(reject, `Failed to spawn child process (${spawnLine})`, err));


            // Резолвим по завершении процесса.
            child.on('exit', (code, signal) => {

                winston.info(`Child process [${command}] exited with code [${code}] and signal [${signal}]`);
                if (stdout.length > 0) winston.info(`STDOUT: ${os.EOL}${os.EOL}${stdout}`);
                if (stderr.length > 0) winston.info(`STDERR: ${os.EOL}${os.EOL}${stderr}`);

                resolve({ code: code, signal: signal, stdout: stdout.length > 0 ? stdout : null, stderr: stderr.length > 0 ? stderr : null });

            });

        });
    },

    /**
     * Выполнить запись ошибки в лог и вызов функции reject.
     * @param {function(*):void} reject - Функция reject.
     * @param {string} message - Сообщение об отказе
     * @param {Error} [err] - Экземпляр ошибки. 
     * @returns {void}
     */
	ErrorAndThrow(message, err) {

		// Логируем ошибку при ее наличии.
		if (err) winston.error(err.stack || err.toString());

		// Отклоняем с новой ошибкой.
		throw new Error(message);
	},

    /**
     * Выполнить запись ошибки в лог и вызов функции reject.
     * @param {function(*):void} reject - Функция reject.
     * @param {string} message - Сообщение об отказе
     * @param {Error} [err] - Экземпляр ошибки. 
     * @returns {void}
     */
    ErrorAndReject(reject, message, err) {

        // Логируем ошибку при ее наличии.
        if (err) winston.error(err.stack || err.toString());

        // Отклоняем с новой ошибкой.
        reject(new Error(message));

    },

    /**
     * Выполнить запись ошибки в лог и консоль и вызов функции reject.
     * @param {function(*):void} reject - Функция reject.
     * @param {string} message - Новое сообщение об ошибке.
     * @param {string} [extraMessage] - Дополнительные детали ошибки, записываемые в лог.
     * @param {Error} [err] - Экземпляр ошибки. 
     * @returns {void}
     */
    ErrorAndRejectConsole(reject, message, extraMessage, err) {

        // Логируем ошибку при ее наличии.
        if (err) winston.error(err.stack || err.toString());

        const fullMessage = message + (extraMessage || '');

        // Логируем сообщение в лог и консоль.
        winston.error(fullMessage);
        console.log('FAIL: ' + message);

        // Отклоняем с новой ошибкой.
        reject(new Error(fullMessage));
    },

    /**
     * Выполнить запись информационного в лог и вызов функции resolve.
     * @param {function(*):void} reject - Функция resolve.
     * @param {string} message - Сообщение для записи в лог.
     * @param {any} [resolveContext] - Аргумент вызова resolve. 
     * @returns {void}
     */
    InfoAndResolve(resolve, message, resolveContext) {


        // Логируем сообщение в лог и консоль.
        winston.info(message);

        // Отклоняем с новой ошибкой.
        resolve(resolveContext);

    },

    /**
     * Выполнить запись информационного в лог и консоль и вызов функции resolve.
     * @param {function(*):void} reject - Функция resolve.
     * @param {string} message - Сообщение для записи в лог.
     * @param {any} [resolveContext] - Аргумент вызова resolve. 
     * @returns {void}
     */
    InfoAndResolveConsole(resolve, message, resolveContext) {


        // Логируем сообщение в лог и консоль.
        winston.info(message);
        console.log('INFO: ' + message);

        // Отклоняем с новой ошибкой.
        resolve(resolveContext);

    }

};