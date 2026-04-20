// This is Poll-san/events/verification.js

const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const helpers = require('../utils/helpers');

// A simple in‑memory store to prevent spam (optional)
const cooldown = new Set();

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        // Assign the Unverified role when someone joins
        const unverifiedRole = member.guild.roles.cache.get(helpers.ids.roles.unverified);
        if (unverifiedRole) {
            await member.roles.add(unverifiedRole).catch(console.error);
        }

        // Optional: send a welcome DM
        try {
            await member.send(`Welcome to **${member.guild.name}**! Please verify in the <#${helpers.ids.channels.verify}> channel.`);
        } catch (error) {
            console.log(`Could not DM ${member.user.tag}`);
        }
    },

    // Also listen for interactions (buttons, modals)
    [Events.InteractionCreate]: {
        async execute(interaction) {
            if (!interaction.isButton() && !interaction.isModalSubmit()) return;

            // ---------- BUTTON: open the verification modal ----------
            if (interaction.isButton() && interaction.customId === 'verify_modal_btn') {
                // Cooldown check (e.g. 30 seconds)
                if (cooldown.has(interaction.user.id)) {
                    return interaction.reply({ content: '⏳ Please wait a moment before trying again.', ephemeral: true });
                }

                const modal = new ModalBuilder()
                    .setCustomId('verify_modal')
                    .setTitle('Verification – Math Captcha');

                const mathQuestion = generateMathQuestion(); // see function below
                // Store the correct answer in a temporary place (attached to the modal)
                modal.setComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('captcha_answer')
                            .setLabel(mathQuestion.text)
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('Enter your answer')
                            .setRequired(true)
                    )
                );
                // Attach the expected answer to the modal as custom data (hack: use a Map)
                modal.expectedAnswer = mathQuestion.answer;

                await interaction.showModal(modal);
                cooldown.add(interaction.user.id);
                setTimeout(() => cooldown.delete(interaction.user.id), 30000);
            }

            // ---------- MODAL SUBMIT: check answer and verify ----------
            if (interaction.isModalSubmit() && interaction.customId === 'verify_modal') {
                const userAnswer = interaction.fields.getTextInputValue('captcha_answer');
                const expectedAnswer = interaction.expectedAnswer; // from the button handler

                if (parseInt(userAnswer) === expectedAnswer) {
                    // Success – assign Verified role, remove Unverified
                    const member = interaction.member;
                    const unverifiedRole = interaction.guild.roles.cache.get(helpers.ids.roles.unverified);
                    const verifiedRole = interaction.guild.roles.cache.get(helpers.ids.roles.verified);

                    if (verifiedRole && unverifiedRole) {
                        await member.roles.add(verifiedRole);
                        await member.roles.remove(unverifiedRole);
                    }

                    // Send success embed (style from your video)
                    const successEmbed = new EmbedBuilder()
                        .setColor(0x2f3136)
                        .setDescription(
                            `# You Successfully Verified!\n` +
                            `Thanks for verifying!\n` +
                            `You now have access to the rest of the server.`
                        )
                        .setImage('https://cdn.discordapp.com/attachments/1163490254221738015/1167472390213730335/Embed_Extender_Invisible_Space.png');

                    await interaction.reply({ embeds: [successEmbed], ephemeral: true });
                    // Optional: log success to a staff channel
                    logVerification(interaction.guild, member.user, true);
                } else {
                    // Failure
                    const failEmbed = new EmbedBuilder()
                        .setDescription('❌ Verification unsuccessful. Please try again.')
                        .setColor(0xff8b1f);
                    await interaction.reply({ embeds: [failEmbed], ephemeral: true });
                    logVerification(interaction.guild, interaction.user, false);
                }
            }
        }
    }
};

// Helper: generate a random math question (e.g. "12 + 7")
function generateMathQuestion() {
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    const operators = ['+', '-'];
    const op = operators[Math.floor(Math.random() * operators.length)];
    let answer;
    let text;
    if (op === '+') {
        answer = a + b;
        text = `${a} + ${b} = ?`;
    } else {
        // ensure positive result
        const max = Math.max(a, b);
        const min = Math.min(a, b);
        answer = max - min;
        text = `${max} - ${min} = ?`;
    }
    return { text, answer };
}

// Optional: log to a staff channel (create a #verification-logs channel)
async function logVerification(guild, user, success) {
    const logChannelId = 'PUT_LOG_CHANNEL_ID_HERE'; // optional
    const logChannel = guild.channels.cache.get(logChannelId);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
        .setColor(success ? 0x00f0a8 : 0xff006f)
        .setTitle(success ? 'Verification Successful' : 'Verification Failed')
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp()
        .addFields(
            { name: 'User Info', value: `> **User:** ${user.tag} (<@${user.id}>)\n> **ID:** \`${user.id}\``, inline: false },
            { name: 'Action', value: success ? 'User passed verification' : 'User failed the captcha', inline: false }
        );
    logChannel.send({ embeds: [embed] });
}
