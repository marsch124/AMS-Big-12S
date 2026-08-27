/*
 * app.js — boot the app.
 */
(function (global) {
    'use strict';

    global.APP_VERSION = '2.0';

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
            .then(function () {
                UI.applySettings();
                if (!handleLaunchAction()) UI.showScreen('home');
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
