import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      usePolling: true,
      port: 5174, // Enforces the server to launch on 5174 every time
    },
  },
});
 

