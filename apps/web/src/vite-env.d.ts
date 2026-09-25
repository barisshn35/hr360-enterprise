/// <reference types="vite/client" />

/** VITE_MOCK_API=true iken derleme anında true — istekler src/mocks/ tarafından karşılanır. */
declare const __MOCK_API__: boolean
/** VITE_MOCK_AUTH=true iken derleme anında true — Keycloak'a gidilmez, sahte oturum kullanılır. */
declare const __MOCK_AUTH__: boolean
