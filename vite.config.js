import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        account: resolve(__dirname, 'account.html'),
        cart: resolve(__dirname, 'cart.html'),
        login: resolve(__dirname, 'login.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        'product-detail': resolve(__dirname, 'product-detail.html'),
        products: resolve(__dirname, 'products.html'),
        register: resolve(__dirname, 'register.html'),
        shipping: resolve(__dirname, 'shipping.html'),
        terms: resolve(__dirname, 'terms.html'),
        wishlist: resolve(__dirname, 'wishlist.html'),
        // Add any other top-level HTML pages here
      },
    },
  },
}) 