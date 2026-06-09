// This is poll-san/utils/helpers.js

module.exports = {
    POLL_UPDATE_INTERVAL_MS: 10000,

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

    emojis: [
        '<:one:1485655941520167062>',
        '<:two:1485655967436767252>',
        '<:three:1485655981194215505>',
        '<:four:1487623282722344970>',
        '<:five:1487623335306072297>',
        '<:six:1485656011040620654>',
        '<:seven:1485656023061627060>',
        '<:eight:1487623383897210961>',
        '<:nine:1487623395053932636>',
        '<:ten:1485656068943253786>',
        '<:eleven:1485656186060542104>',
        '<:twelve:1485656217194991667>'
    ],
    reactIds: [
        '1485655941520167062',
        '1485655967436767252',
        '1485655981194215505',
        '1487623282722344970',
        '1487623335306072297',
        '1485656011040620654',
        '1485656023061627060',
        '1487623383897210961',
        '1487623395053932636',
        '1485656068943253786',
        '1485656186060542104',
        '1485656217194991667'
    ],

    releaseEmojis: {
        NEW1: '<a:NEW1:1491321234015911977>',
        NEW2: '<a:NEW2:1491321257780580414>',
        DISCORD: '<a:discord:1503836514986102875>',
        VERIFY: '<a:Verify:1491669023245729924>',
        VERIFY_BLUE: '<a:Verifyblue:1501010309790437467>',
        VERIFY_PINK: '<a:Verifypink:1501010311279542312>',
        VERIFY_RED: '<a:Verifyred:1501010312583712778>',
        VERIFY_YELLOW: '<a:Verifyyellow:1501010314077012150>',
        EIGHTEEN: '<a:18:1491670036799029288>',
        EIGHTEENPLUS: '<a:18plus:1501639943443709952>',
        LINK: '<a:Link:1491670128562274475>',
        BATSU: '<a:batsu:1506695861139275947>',
        ALERT: '<a:alert:1493698480034676736>',
        HOURGLASS: '<a:Hourglass:1491762676416905267>',
        CHAT: '<a:chat:1491669036998594600>',
        STAR: '<a:star:1506891386622840873>',
        CONFETTI: '<a:confetti:1491689074002755664>',
        SPARKLES: '<a:sparkles:1491697348718493786>',
        PROGRESS: '<a:progress:1491670111923212308>',
        SPEECH: '<a:speech:1506709601758744828>',
        DICE: '<a:dice:1491669867441426542>',
        PIXELSKY: '<a:pixelsky:1507262649878974584>',
        HEART: '<a:heart:1511391137825558628>',
        CATCOIN: '<a:catcoin:1506632039749910598>',
        YOSHICOIN: '<:yoshicoin:1506632090165313586>',
        SKULL: '<:skull:1506692152313512046>',
        TICKET: '<a:ticket:1506633750300327949>',
        WAVE: '<a:wave:1492326023080185987>',
        MONEYBAG: '<a:moneybag:1514041718989918388>',
        waveId: '1492326023080185987',
        
        VERIFY_EMOJIS: [
            '<a:Verify:1491669023245729924>',
            '<a:Verifyblue:1501010309790437467>',
            '<a:Verifypink:1501010311279542312>',
            '<a:Verifyred:1501010312583712778>',
            '<a:Verifyyellow:1501010314077012150>'
        ],

        getRandomVerify: function() {
            return this.VERIFY_EMOJIS[Math.floor(Math.random() * this.VERIFY_EMOJIS.length)];
        },

        ARROWS: [
            '<a:arrowyellow:1491672823729623212>',
            '<a:arrowwhite:1491672813398917150>',
            '<a:arrowred:1491672803030732850>',
            '<a:arrowpurple:1491672794235146260>',
            '<a:arrowpink:1491672773716873257>',
            '<a:arroworange:1491672761582489681>',
            '<a:arrowmagenta:1491672750849396756>',
            '<a:arrowgreen:1491672741495963738>',
            '<a:arrowcyan:1491672731572375573>',
            '<a:arrowblue:1491672719140589638>'
        ],
        DOWN_ARROWS: [
            '<a:arrowdownblue:1491763134590091335>',
            '<a:arrowdowncyan:1491763136011960511>',
            '<a:arrowdowngreen:1491763137580498954>',
            '<a:arrowdownmagenta:1491763139279323196>',
            '<a:arrowdownorange:1491763140914970655>',
            '<a:arrowdownpink:1491763142231986310>',
            '<a:arrowdownpurple:1491763143561711696>',
            '<a:arrowdownred:1491763144601895052>',
            '<a:arrowdownwhite:1491763145843281931>',
            '<a:arrowdownyellow:1491763147063820309>',
        ],
        UP_ARROWS: [
            '<a:arrowupblue:1492637578359476554>',
            '<a:arrowupcyan:1492637580033003630>',
            '<a:arrowupgreen:1492637581077123205>',
            '<a:arrowupmagenta:1492637582570422334>',
            '<a:arrowuporange:1492637583753084958>',
            '<a:arrowuppink:1492637584965243091>',
            '<a:arrowuppurple:1492637586714267648>',
            '<a:arrowupred:1492637588220280912>',
            '<a:arrowupwhite:1492637589331640320>',
            '<a:arrowupyellow:1492637590409445539>'
        ],
        PRESENT_BLUE: '<a:presentblue:1499806107844087879>',
        PRESENT_GREEN: '<a:presentgreen:1499806108682817687>',
        PRESENT_PINK: '<a:presentpink:1499806109949497485>',
        PRESENT_PURPLE: '<a:presentpurple:1499806111153393766>',
        PRESENT_RED: '<a:presentred:1499806112462143498>',
        PRESENT_VALENTINE: '<a:presentvalentine:1499806113691074560>',
    },

    getRandomPresent: function() {
        const presents = [
            this.releaseEmojis.PRESENT_BLUE,
            this.releaseEmojis.PRESENT_GREEN,
            this.releaseEmojis.PRESENT_PINK,
            this.releaseEmojis.PRESENT_PURPLE,
            this.releaseEmojis.PRESENT_RED
        ];
        return presents[Math.floor(Math.random() * presents.length)];
    },

    getTwoRandomPresents: function() {
        const presents = [
            this.releaseEmojis.PRESENT_BLUE,
            this.releaseEmojis.PRESENT_GREEN,
            this.releaseEmojis.PRESENT_PINK,
            this.releaseEmojis.PRESENT_PURPLE,
            this.releaseEmojis.PRESENT_RED
        ];
        const firstIndex = Math.floor(Math.random() * presents.length);
        let secondIndex = Math.floor(Math.random() * presents.length);
        while (secondIndex === firstIndex) {
            secondIndex = Math.floor(Math.random() * presents.length);
        }
        return { left: presents[firstIndex], right: presents[secondIndex] };
    },

    ids: {
        roles: {
            female_supporter: '1465968041404928177',
            male_supporter: '1465967964804350160',
            server_booster: '1469284491456548976',
            supporter: '1466155709547675795',
            giveaway_notify_role: '1472273843665113139',
            restricted: ['1468666174102442227', '1467233133362544642', '1487554855068368916'],
            unverified: '1495679222264627321',
            member: '1495684657730158724',
            creator: '1466144237643890728'
        },
        tags: {
            preview_female: '1465939310720192637',
            preview_male: ['1465939329120469095', '1467020233272328195'],
            supporter_female: '1465939610642415921',
            supporter_male: ['1465939591352680488', '1467020371428642957'],
            poll_mention: '1472273843665113139',
        },
        channels: {
            QUEUE: '1473730427318435860',
            TRIVIA: '1495387346990928003',
            verify: '1495679452489977897',
            checkin: '1495862994343694447',
            preview_forum: '1465938599378812980',
            supporter_forum: '1465937644394512516',
            mudae_roll: '1494520781244334291',
            admin_channel: '1504216521839345824',
            audit_log: '1494737302260551822',
            xp_channel: '1504218575580430436'
        },
        users: {
            Velutinx: '1380051214766444617'
        },
        bots: {
            rinbot: '429656936435286016',
            mudae: '432610292342587392'
        }
    },

    weights: {
        tiers: {
            '1495684657730158724': 0.9,
            '1465444240845963326': 1.1,
            '1465670134743044139': 1.3,
            '1465904476417163457': 2.0,
            '1465904548320378956': 2.5,
            '1465952085026541804': 3.0
        },
        tierMapping: {
            1: '1465444240845963326',
            2: '1465670134743044139',
            3: '1465904476417163457',
            4: '1465904548320378956',
            5: '1465952085026541804'
        },
        tierNames: {
            1: 'Bronze',
            2: 'Copper',
            3: 'Silver',
            4: 'Gold',
            5: 'Platinum'
        },
        booster: '1469284491456548976',
        xpFactor: 0.02
    },

    // ==================== GAMES CONFIGURATION ====================
    games: {
        wordle: {
            botId: '1326731868137062492',
            channelId: '1494747527801470986',
            cooldownHours: 24,
            winPattern: /Wordle\s+[\d,]+\s+(\d|X)\/6/,
            activityAppId: '947466344113963018'
        },
        hangman: {
            channelId: '1494747527801470986',
            cooldownHours: 24,
            winPattern: /^You win!$/
        },
        trivia: {
            botId: '429656936435286016',
            channelId: '1495387346990928003',
            dailyTicketCap: 10,
            cleanupDelayMs: 15000
        }
    },

    colors: {
        success: 0x00FFCC,
        giveaway: '#FF69B4',
        ended: '#808080'
    },

    urls: {
        base: "https://www.velutinx.com",
        pollImages: "https://www.velutinx.com/images/poll/",
        LOGO_URL: 'https://www.velutinx.com/images/LogoDiscord.png',
        CLOUDFLARE_D1_WORKER: 'https://database-one-time-setup.velutinx.workers.dev'
    },

    // ==================== CLOUDFLARE D1 TABLES ====================
    tables: {
        // Games
        GAMES_COOLDOWNS: 'games_cooldowns',
        GAMES_MUDAE_CLAIMS: 'games_mudae_claims',
        GAMES_PURCHASES: 'games_purchases',
        GAMES_TRIVIA_DAILY: 'games_trivia_daily',
        GAMES_TRIVIA_SESSIONS: 'games_trivia_sessions',
        GAMES_USER_DATA: 'games_user_data',
        GAMES_WORDLE: 'games_wordle',

        // Purchases
        MEMBER_MESSAGE_LOG: 'purchase_member_message_log',
        MEMBERSHIPS: 'purchase_memberships',
        PRICE_KEYS: 'purchase_price_keys',
        PRICE_TIERS: 'purchase_price_tiers',
        SUCCESSS: 'purchase_success',

        // Poll
        POLL_AUTO_RESUME: 'poll_auto_resume',
        POLL_VOTES_FINAL: 'poll_votes_final',
        POLL_VOTING_DISCORD: 'poll_voting_discord',
        POLL_VOTING_WEBSITE: 'poll_voting_website',

        // Settings & others
        GIVEAWAYS: 'settings_giveaways',
        MAIN_QUEUE: 'settings_main_queue',
        SERVER_SETTINGS: 'settings_server_settings',
        SYNC_STATE: 'settings_sync_state',
        USER_XP: 'settings_user_xp'
    },

    // ==================== REDEEM STORE ====================
    redeem: {
        voteBoostCost: 200,
        suggestCost: 300,
        characterRequestCost: 300,
        voteBoostDurationDays: 7
    },

    // ==================== WHITELISTED MESSAGE IDs ====================
    whitelistedMessages: {
        '1494520781244334291': [
            '1498065129626013757',
            '1498065147044823290',
            '1501703483727024191',
            '1501703541901758604',
            '1501893893606608956',
            '1501893910383825016'
        ],
        '1494747527801470986': [
            '1507132260229447832',
            '1507132334359711794',
            '1507133368318296098',
            '1507133372806463518',
            '1507133533666148584'
        ]
    },

    CHECKIN_REWARD_TICKETS: 50,

    sightengine: {
        apiUser: '1626192318',
        apiSecret: 'ParHXHCpXwt2eQ7SePcCZJjfHsJc6Kdk'
    },

    avatarRestrictedChannels: [
        '1466147508345503953',
        '1472450019067171008',
        '1467280145315528955',
        '1469437804231659660'
    ],

    avatarRestrictedCategories: [
        '1401446105421451364',
        '1465921730785579141',
        '1494747375204433940',
        '1466151443286196451'
    ]
};
