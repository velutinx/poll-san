// services/triviaImage.js
const sharp = require('sharp');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const { putR2Image, getR2Image } = require('./r2Storage');
const RAINBOW_OVERLAY_URL = 'https://www.velutinx.com/images/rainbow_foreground.jpg';
const SECTIONS = 12;

async function downloadImage(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download image: ${response.status}`);
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
}

async function createTriviaImage(originalImage, sectionsVisible, overlayImage) {
    const metadata = await sharp(originalImage).metadata();
    const { width, height } = metadata;
    const sectionWidth = Math.floor(width / 3);
    const sectionHeight = Math.floor(height / 4);
    const overlayResized = await sharp(overlayImage)
        .resize(width, height, { fit: 'fill' })
        .toBuffer();

    let result = originalImage;
    const overlayBufferFull = overlayResized;

    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 3; col++) {
            const sectionIndex = row * 3 + col;
            const isVisible = sectionIndex < sectionsVisible;

            if (!isVisible) {
                const overlaySection = await sharp(overlayBufferFull)
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

function getTriviaImageKey(folderName, version) {
    return `images/trivia/${folderName}/trivia_${version}.jpg`;
}

async function processAndUploadTriviaImage(originalImageBuffer, folderName, sectionsVisible = 1) {
    const overlayBuffer = await downloadImage(RAINBOW_OVERLAY_URL);
    const compositeImage = await createTriviaImage(originalImageBuffer, sectionsVisible, overlayBuffer);
    const key = getTriviaImageKey(folderName, sectionsVisible);
    const result = await putR2Image(key, compositeImage, 'image/jpeg');

    return {
        key,
        url: result.url,
        sectionsVisible
    };
}

async function updateTriviaImage(folderName, sectionsVisible, originalImageKey) {
    const originalImageBuffer = await getR2Image(originalImageKey);
    const overlayBuffer = await downloadImage(RAINBOW_OVERLAY_URL);
    const compositeImage = await createTriviaImage(originalImageBuffer, sectionsVisible, overlayBuffer);
    const key = getTriviaImageKey(folderName, sectionsVisible);
    const result = await putR2Image(key, compositeImage, 'image/jpeg');

    return {
        key,
        url: result.url,
        sectionsVisible
    };
}

module.exports = {
    createTriviaImage,
    processAndUploadTriviaImage,
    updateTriviaImage,
    getTriviaImageKey,
    SECTIONS
};
