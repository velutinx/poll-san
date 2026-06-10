const fs = require("fs");
const path = require("path");

module.exports = async function(client){

    const guildId = process.env.GUILD_ID;
    const guild = await client.guilds.fetch(guildId);

    await guild.emojis.fetch();

    const folder = path.join(__dirname,"..","temporal");

    if(!fs.existsSync(folder)) return;

    const files = fs.readdirSync(folder)
        .filter(x=>x.endsWith(".gif"));

    if(files.length===0) return;

    console.log("=== Updating Emojis ===");

    for(const file of files){

        const emojiName = file
            .replace(/-/g,"")
            .replace(".gif","")
            .toLowerCase();

        const oldEmoji = guild.emojis.cache.find(
            e=>e.name.toLowerCase()===emojiName
        );

        if(oldEmoji){

            console.log(
                `Deleting ${oldEmoji.name} (${oldEmoji.id})`
            );

            await oldEmoji.delete();
        }

        const emoji = await guild.emojis.create({
            attachment:path.join(folder,file),
            name:emojiName
        });

        console.log("");

        console.log(file);

        console.log(
            `Name: ${emoji.name}`
        );

        console.log(
            `ID: ${emoji.id}`
        );

        console.log(
            `<${emoji.animated?"a":""}:${emoji.name}:${emoji.id}>`
        );

        console.log("");
    }

    console.log("=== Done ===");
};
