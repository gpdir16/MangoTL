import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Passwords are hashed with scrypt + a per-password random salt (node:crypto,
// no dependencies). Stored as "saltHex:hashHex". An empty stored value means the
// password is not set, which is also the bootstrap state that lets the first
// settings password be configured without authentication.
export function hashPassword(password) {
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 32);
    return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password, stored) {
    if (!password || typeof stored !== "string" || !stored) {
        return false;
    }

    const [saltHex, hashHex] = stored.split(":");
    if (!saltHex || !hashHex) {
        return false;
    }

    try {
        const hash = scryptSync(password, Buffer.from(saltHex, "hex"), 32);
        // ponytail: scryptSync per gated request (~tens of ms); translation itself
        // takes seconds so this is noise. Move to a cached verify if a high-QPS
        // public translate endpoint ever needs it.
        return timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
    } catch {
        return false;
    }
}

export function accessKeyFrom(request) {
    return request.headers.get("x-access-key") || "";
}

// Only same-origin requests (the settings page itself) may change settings,
// so a random website cannot read/overwrite the API key via CORS.
export function isSameOriginRequest(request) {
    const origin = request.headers.get("origin");

    if (!origin) {
        return true;
    }

    try {
        return new URL(origin).host === request.headers.get("host");
    } catch {
        return false;
    }
}
