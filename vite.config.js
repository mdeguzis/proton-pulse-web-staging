// Vite config for the static site
// In dev mode, vite serves every .html file in the root as its own page route
// HMR auto-reloads CSS on save, no full page refresh needed
// https://vitejs.dev/config/

export default {
  root: '.',
  server: {
    port: 5173,
    open: '/index.html',
    fs: {
      // let vite read the assets/ folder which lives at root
      strict: false,
    },
  },
  // tell vite which html entries to build into the production bundle
  build: {
    rollupOptions: {
      input: {
        index:      'index.html',
        app:        'app.html',
        auth:       'auth.html',
        profile:    'profile.html',
        privacy:    'privacy.html',
        terms:      'terms.html',
        pluginLink: 'plugin-link.html',
      },
    },
  },
}
