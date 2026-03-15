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
        // Use member.user.username for the global account handle (velutinxx)
        const globalUsername = member.user.username; 
        const mention = `<@${member.id}>`;
        const serverName = member.guild.name;
        const count = member.guild.memberCount.toLocaleString();

        // 3. Replace Tags in the chosen string
        // We use the global username for {user(proper)} as requested
        message = message.split('{user(proper)}').join(globalUsername);
        message = message.split('{user}').join(mention);
        message = message.split('{server}').join(serverName);
        message = message.split('{members}').join(count);

        return message;
    }
};