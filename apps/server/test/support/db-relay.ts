import net from "node:net";

export interface DatabaseRelay {
    /** Die Verbindungsadresse über das Relais. */
    url: string;
    /** Trennt jede Verbindung und weist neue ab: die Datenbank ist „weg“. */
    cut(): Promise<void>;
    /** Nimmt auf demselben Port wieder an. */
    restore(): Promise<void>;
    close(): Promise<void>;
}

/**
 * Ein Relais vor der Datenbank (WI-0127 SYS-2, SYS-3): `cut()` trennt jede Verbindung und weist neue ab (die Datenbank ist „weg“),
 * `restore()` nimmt sie auf demselben Port wieder an. So verschwindet die Datenbank für EINE Instanz, ohne dass die Testdatenbank
 * selbst angehalten wird.
 */
export async function relayTo(url: string): Promise<DatabaseRelay> {
    const target = new URL(url);
    const sockets = new Set<net.Socket>();
    const server = net.createServer((client) => {
        const upstream = net.connect(Number(target.port || 5432), target.hostname);
        for (const socket of [client, upstream]) {
            sockets.add(socket);
            socket.on("close", () => sockets.delete(socket));
            socket.on("error", () => socket.destroy());
        }
        client.pipe(upstream).pipe(client);
    });
    const listen = (port: number) =>
        new Promise<number>((resolve, reject) => {
            server.once("error", reject);
            server.listen(port, "127.0.0.1", () => {
                server.off("error", reject);
                resolve((server.address() as net.AddressInfo).port);
            });
        });
    const port = await listen(0);
    const relayed = new URL(url);
    relayed.port = String(port);
    const cut = async () => {
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
            for (const socket of sockets) socket.destroy();
        });
    };
    return {
        url: relayed.toString(),
        cut,
        restore: async () => {
            await listen(port);
        },
        close: async () => {
            if (server.listening) await cut();
        },
    };
}
