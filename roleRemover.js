// roleRemover.js
module.exports = (client) => {
  const guildId = process.env.GUILD_ID;
  const role1 = '1467233133362544642';  // SubscribeStar All Subscribers
  const role2 = '1468666174102442227';  // SubscribeStar $0.00 tier
  const checkInterval = 3600000;        // 1 hour = 60 * 60 * 1000 ms

  // On member join → remove roles immediately if present
  client.on('guildMemberAdd', async (member) => {
    if (member.guild.id !== guildId) return;
    if (member.roles.cache.has(role1) || member.roles.cache.has(role2)) {
      try {
        await member.roles.remove([role1, role2]);
        console.log(`Removed roles from new member: ${member.user.tag}`);
      } catch (error) {
        console.error(`Failed to remove roles from ${member.user.tag}:`, error);
      }
    }
  });

  // Periodic check → every 1 hour
  setInterval(async () => {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return console.error('Guild not found');

    try {
      const members = await guild.members.fetch();
      members.forEach(async (member) => {
        if (member.roles.cache.has(role1) || member.roles.cache.has(role2)) {
          try {
            await member.roles.remove([role1, role2]);
            console.log(`Removed roles from ${member.user.tag} (periodic check)`);
          } catch (error) {
            console.error(`Failed to remove roles from ${member.user.tag}:`, error);
          }
        }
      });
    } catch (error) {
      console.error('Error in periodic role check:', error);
    }
  }, checkInterval);

  console.log('Role remover setup complete (hourly periodic check)');
};