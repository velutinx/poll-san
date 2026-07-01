// services/triviaImage.js
const sharp = require('sharp');
const { putR2Image, getR2Image } = require('./r2Storage');

const RAINBOW_OVERLAY_URL = 'https://www.velutinx.com/images/rainbow_foreground.jpg';
const SECTIONS = 12;

async function downloadImage(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download overlay: ${response.status}`);
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
}

async function createTriviaImage(originalImage, revealedSections, overlayImage) {
    const metadata = await sharp(originalImage).metadata();
    const { width, height } = metadata;
    const sectionWidth = Math.floor(width / 3);
    const sectionHeight = Math.floor(height / 4);

    const overlayResized = await sharp(overlayImage)
        .resize(width, height, { fit: 'fill' })
        .toBuffer();

    const revealedSet = new Set(revealedSections);
    let result = originalImage;

    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 3; col++) {
            const sectionIndex = row * 3 + col;
            if (!revealedSet.has(sectionIndex)) {
                const overlaySection = await sharp(overlayResized)
                    .extract({
                        left: col * sectionWidth,
                        top: row * sectionHeight,
                        width: sectionWidth,
                        height: sectionHeight
                    })
                    .toBuffer();

                result = await sharp(result)
                    .composite([{
                        input: overlaySection,
                        left: col * sectionWidth,
                        top: row * sectionHeight,
                        blend: 'over'
                    }])
                    .jpeg({ quality: 85 })
                    .toBuffer();
            }
        }
    }

    return result;
}

function getTriviaImageKey(folderName) {
    return `images/trivia/${folderName}/trivia.jpg`;
}

function getOriginalImageKey(folderName) {
    return `images/trivia/${folderName}/original.jpg`;
}

async function uploadTriviaImage(originalImageBuffer, folderName, revealedSections) {
    const overlayBuffer = await downloadImage(RAINBOW_OVERLAY_URL);
    const compositeImage = await createTriviaImage(originalImageBuffer, revealedSections, overlayBuffer);
    const key = getTriviaImageKey(folderName);
    const result = await putR2Image(key, compositeImage, 'image/jpeg');
    return {
        url: result.url,
        key,
    };
}

async function uploadOriginalImage(originalImageBuffer, folderName) {
    const key = getOriginalImageKey(folderName);
    const result = await putR2Image(key, originalImageBuffer, 'image/jpeg');
    return { url: result.url, key };
}

async function getOriginalImage(folderName) {
    const key = getOriginalImageKey(folderName);
    return await getR2Image(key);
}

module.exports = {
    uploadTriviaImage,
    uploadOriginalImage,
    getOriginalImage,
    getTriviaImageKey,
    getOriginalImageKey,
    SECTIONS
};
