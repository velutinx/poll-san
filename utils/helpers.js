// poll-san/utils/helpers.js

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

    // --- POLL SYSTEM (Legacy) ---
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

    // --- NEW RELEASE SYSTEM EMOJIS ---
releaseEmojis: {
        NEW1: '<a:NEW1:1491321234015911977>',
        NEW2: '<a:NEW2:1491321257780580414>',
        VERIFY: '<a:Verify:1491669023245729924>',
        EIGHTEEN: '<a:18:1491670036799029288>',
        LINK: '<a:Link:1491670128562274475>',
        CONFETTI: '<a:confetti:1491689074002755664>',
        SPARKLES: '<a:sparkles:1491697348718493786>',
        PROGRESS: '<a:progress:1491670111923212308>',
        WAVE: '<a:wave:1492326023080185987>', // New animated emoji
        waveId: '1492326023080185987',        // ID for reactions
        
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
            '<a:arrowdownyellow:1491763147063820309>'
        ]
    },

    // --- CHANNEL & ROLE IDs ---
    ids: {
        roles: {
            female_supporter: '1465968041404928177',
            male_supporter: '1465967964804350160',
            server_booster: '1469284491456548976',
            supporter: '1466155709547675795',
            restricted: ['1468666174102442227', '1467233133362544642', '1487554855068368916']
        },
        tags: {
            preview_female: '1465939310720192637',
            preview_male: ['1465939329120469095', '1467020233272328195'],
            supporter_female: '1465939610642415921',
            supporter_male: ['1465939591352680488', '1467020371428642957'],
            poll_mention: '1472273843665113139',
        },
        channels: {
            QUEUE: '1473730427318435860' // :hourglass_flowing_sand:large-requests-queue - channel
        },
        users: {
            Velutinx: '1380051214766444617'
        }
    },

    weights: {
        tiers: {
            '1465444240845963326': 1.2, // Bronze
            '1465670134743044139': 1.5, // Copper
            '1465904476417163457': 1.8, // Silver
            '1465904548320378956': 2.0, // Gold
            '1465952085026541804': 2.3  // Platinum
        },

        tierMapping: {
                1: '1465444240845963326',
                2: '1465670134743044139',
                3: '1465904476417163457',
                4: '1465904548320378956',
                5: '1465952085026541804'
        },            
        booster: '1469284491456548976', // booster
        xpFactor: 0.02
    },

    colors: {
        success: 0x00FFCC,
        giveaway: '#FF69B4',
        ended: '#808080'
    },

    urls: {
        base: "https://www.velutinx.com",
        pollImages: "https://www.velutinx.com/images/poll/"
    },
    
};
