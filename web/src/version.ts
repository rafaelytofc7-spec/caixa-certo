// Versão do app (aparece em Config. e entra no nome do cache do service worker).
declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
