// Type stub for opencascade.js (no official @types package)
declare module 'opencascade.js' {
    const initOpenCascade: (opts?: { locateFile?: (file: string) => string }) => Promise<any>;
    export { initOpenCascade };
    export default initOpenCascade;
}
