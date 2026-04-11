// this is poll-san/services/parserService.js

const h = require('../utils/helpers');

module.exports = {
    parseMessage: (text, member) => {
        if (!text) return "";
        let message = text;

        // 1. Handle {random: ... ~ ...}
        if (message.includes('{random:')) {
            try {
                const startIdx = message.indexOf('{random:') + 8;
                const endIdx = message.lastIndexOf('}');
                
                if (endIdx > startIdx) {
                    const content = message.substring(startIdx, endIdx);
                    const options = content.split('~')
                        .map(opt => opt.trim())
                        .filter(opt => opt.length > 0);
                    
                    if (options.length > 0) {
                        message = options[Math.floor(Math.random() * options.length)];
                    }
                }
            } catch (e) {
                console.error("Parser Error (Random):", e);
            }
        }

        // 2. Data to insert
        const globalUsername = member.user.username; 
        const mention = `<@${member.id}>`;
        const serverName = member.guild.name;
        const count = member.guild.memberCount.toLocaleString();

        // 3. Animated Arrow Logic
        const e = h.releaseEmojis;
        const randomDown = e.DOWN_ARROWS[Math.floor(Math.random() * e.DOWN_ARROWS.length)];
        const randomUp = e.UP_ARROWS[Math.floor(Math.random() * e.UP_ARROWS.length)];

        // 4. Replace Tags in the chosen string
        message = message.split('{user(proper)}').join(globalUsername);
        message = message.split('{user}').join(mention);
        message = message.split('{server}').join(serverName);
        message = message.split('{members}').join(count);
        
        // Custom Tags for your new animated arrows
        message = message.split('{random_down_arrow}').join(randomDown);
        message = message.split('{random_up_arrow}').join(randomUp);
        
        // Support for other static release emojis if needed
        message = message.split('{link_icon}').join(e.LINK);
        message = message.split('{confetti}').join(e.CONFETTI);
        message = message.split('{hourglass}').join(e.HOURGLASS);

        return message;
    }
};
