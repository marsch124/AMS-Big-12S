/*
 * app.js — boot the app.
 */
(function (global) {
    'use strict';

    global.APP_VERSION = '2.37';

    function handleLaunchAction() {
        var action = new URLSearchParams(location.search).get('action');
        if (!action) return false;

        // Drop the query string so a reload does not repeat the shortcut.
        history.replaceState({}, '', location.pathname);

        if (action === 'notes') { UI.showScreen('notes'); return true; }
        if (action === 'search') { UI.showScreen('search'); return true; }
        if (action === 'continue') {
            var position = Store.state.position;
            if (position && Store.getSection(position.sectionId)) {
                UI.openReader(position.sectionId, { paraIndex: position.paraIndex });
                return true;
            }
        }
        return false;
    }

    function start() {
        UI.bind();

        Store.init()
            // Before the UI exists, because the UI writes: recording a visit
            // over an empty database would save an empty copy over a full one.
            .then(function () { return Safekeeping.openingUp(); })
            .then(function (recovered) {
                UI.applySettings();
                if (!handleLaunchAction()) UI.showScreen('home');
                // Never silently. Finding the app has quietly rewritten itself
                // is worse than being told it had to.
                if (recovered && recovered.restored) {
                    UI.toast('Your work was put back from the copy kept on this phone — ' +
                        recovered.restored + ' record' + (recovered.restored === 1 ? '' : 's') +
                        '. Worth making a backup file now.', 9000);
                }
            })
            .catch(function (error) {
                console.error('Startup failed', error);
                UI.applySettings();
                UI.showScreen('home');
                UI.toast('Something went wrong loading your data: ' + error.message, 6000);
            });

        if ('serviceWorker' in navigator) {
            global.addEventListener('load', function () {
                navigator.serviceWorker.register('sw.js').catch(function (error) {
                    console.warn('Service worker registration failed', error);
                });
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})(window);
