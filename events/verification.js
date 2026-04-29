// This is Poll-san/events/verification.js

const { Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const helpers = require('../utils/helpers');

// Store expected captcha answers temporarily (user ID -> answer)
const pendingCaptchas = new Map();

// ======================== GUILD MEMBER ADD ========================
module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        // Skip bots
        if (member.user.bot) return;

        // ----- SKIP FOR CREATOR ROLE -----
        if (member.roles.cache.has(helpers.ids.roles.creator)) {
            console.log(`[Verify] ${member.user.tag} has Creator role – skipping Unverified role and verification.`);
            return;
        }

        // If user already has Supporter (e.g., from external sync), skip Unverified role
        const supporterRoleId = helpers.ids.roles.supporter;
        if (member.roles.cache.has(supporterRoleId)) {
            console.log(`[Verify] ${member.user.tag} is already a supporter – skipping unverified role.`);
            return;
        }

        const unverifiedRole = member.guild.roles.cache.get(helpers.ids.roles.unverified);
        if (unverifiedRole) {
            await member.roles.add(unverifiedRole).catch(console.error);
        }

        // Optional: DM welcome message
        try {
            await member.send(`Welcome to **${member.guild.name}**!\nPlease verify in <#${helpers.ids.channels.verify}> to unlock the server.`);
        } catch (error) {
            console.log(`Could not DM ${member.user.tag}`);
        }
    }
};

// ======================== INTERACTION HANDLER ========================
module.exports.handleInteraction = async (interaction) => {
    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    // ---------- BUTTON: open verification modal ----------
    if (interaction.isButton() && interaction.customId === 'verify_modal_btn') {
        // Cooldown (30 seconds)
        const cooldownKey = `verify_cooldown_${interaction.user.id}`;
        if (pendingCaptchas.has(cooldownKey)) {
            return interaction.reply({ content: '⏳ Please wait 30 seconds before trying again.', ephemeral: true });
        }

        const mathQuestion = generateMathQuestion();
        const modal = new ModalBuilder()
            .setCustomId('verify_modal')
            .setTitle('Verification – Math Captcha');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('captcha_answer')
                    .setLabel(mathQuestion.text)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Enter your answer')
                    .setRequired(true)
            )
        );

        // Store the expected answer for this user
        pendingCaptchas.set(interaction.user.id, mathQuestion.answer);
        // Set cooldown
        pendingCaptchas.set(cooldownKey, true);
        setTimeout(() => {
            pendingCaptchas.delete(cooldownKey);
            pendingCaptchas.delete(interaction.user.id);
        }, 30000);

        await interaction.showModal(modal);
        return;
    }

    // ---------- MODAL SUBMIT: check answer ----------
    if (interaction.isModalSubmit() && interaction.customId === 'verify_modal') {
        const userAnswer = interaction.fields.getTextInputValue('captcha_answer');
        const expectedAnswer = pendingCaptchas.get(interaction.user.id);

        if (!expectedAnswer) {
            return interaction.reply({ content: '❌ Verification session expired. Please click the button again.', ephemeral: true });
        }

        const member = interaction.member;
        const supporterRoleId = helpers.ids.roles.supporter;
        const memberRoleId = helpers.ids.roles.member;
        const unverifiedRoleId = helpers.ids.roles.unverified;

        // ----- SKIP FOR CREATOR ROLE -----
        if (member.roles.cache.has(helpers.ids.roles.creator)) {
            return interaction.reply({
                content: '✅ You have the Creator role – no verification needed.',
                ephemeral: true
            });
        }

        const hasSupporter = member.roles.cache.has(supporterRoleId);
        const unverifiedRole = interaction.guild.roles.cache.get(unverifiedRoleId);
        const memberRole = interaction.guild.roles.cache.get(memberRoleId);

        if (parseInt(userAnswer) === expectedAnswer) {
            // Success
            if (hasSupporter) {
                // Supporter: just remove Unverified, do NOT give Member
                if (unverifiedRole) await member.roles.remove(unverifiedRole);
                await interaction.reply({
                    content: '✅ You are already a Supporter – access granted.',
                    ephemeral: true
                });
            } else {
                // Free user: give Member, remove Unverified
                if (memberRole && unverifiedRole) {
                    await member.roles.add(memberRole);
                    await member.roles.remove(unverifiedRole);
                }
                const successEmbed = new EmbedBuilder()
                    .setColor(0x2f3136)
                    .setDescription(
                        `# You Successfully Verified!\n` +
                        `Thanks for verifying!\n` +
                        `You now have the **Member** role and full access.`
                    )
                    .setImage('https://cdn.discordapp.com/attachments/1163490254221738015/1167472390213730335/Embed_Extender_Invisible_Space.png');
                await interaction.reply({ embeds: [successEmbed], ephemeral: true });
            }
            await logVerification(interaction.guild, member.user, true);
        } else {
            // Failure
            const failEmbed = new EmbedBuilder()
                .setDescription('❌ Verification unsuccessful. Please try again.')
                .setColor(0xff8b1f);
            await interaction.reply({ embeds: [failEmbed], ephemeral: true });
            await logVerification(interaction.guild, interaction.user, false);
        }
        // Clean up stored answer
        pendingCaptchas.delete(interaction.user.id);
    }
};

// ======================== HELPER FUNCTIONS ========================
function generateMathQuestion() {
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    const operators = ['+', '-'];
    const op = operators[Math.floor(Math.random() * operators.length)];
    let answer, text;
    if (op === '+') {
        answer = a + b;
        text = `${a} + ${b} = ?`;
    } else {
        const max = Math.max(a, b);
        const min = Math.min(a, b);
        answer = max - min;
        text = `${max} - ${min} = ?`;
    }
    return { text, answer };
}

async function logVerification(guild, user, success) {
    // Optional: replace with your log channel ID, or remove if not needed
    const logChannelId = null; // e.g., '123456789012345678'
    if (!logChannelId) return;
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
    await logChannel.send({ embeds: [embed] });
}
