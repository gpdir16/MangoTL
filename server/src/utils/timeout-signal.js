export function createLinkedTimeoutSignal({ signal, timeoutMs }) {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromParent = () => controller.abort(signal?.reason);

    if (signal?.aborted) {
        abortFromParent();
    } else {
        signal?.addEventListener("abort", abortFromParent, { once: true });
    }

    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new DOMException("Request timed out", "TimeoutError"));
    }, timeoutMs);
    timer.unref?.();

    return {
        signal: controller.signal,
        timedOut: () => timedOut,
        cleanup: () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abortFromParent);
        },
    };
}
