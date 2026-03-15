module.exports = {
    formatTime: (ms) => {
        if (ms <= 0) return "0d 0h 0m 0s";
        const days = Math.floor(ms / 86400000);
        const hours = Math.floor((ms % 86400000) / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${days}d ${hours}h ${minutes}m ${seconds}s`;
    },
    chunkArray: (array, size) => {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
        return chunks;
    },
    emojis: ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','<:eleven:1472456579742961744>','<:twelve:1472456610457718845>'],
    reactIds: ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','1472456579742961744','1472456610457718845'],
    weights: {
        tiers: {
            '1465444240845963326': 1.2,
            '1465670134743044139': 1.5,
            '1465904476417163457': 1.8,
            '1465904548320378956': 2.0,
            '1465952085026541804': 2.3
        },
        booster: '1469284491456548976',
        xpFactor: 0.02
    }
};