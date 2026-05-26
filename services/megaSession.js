app.post('/api/upload-to-mega', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    if (!req.file.originalname.toLowerCase().endsWith('.zip')) {
        return res.status(400).json({ error: 'Only ZIP files are allowed' });
    }
    if (req.file.size > 100 * 1024 * 1024) {
        return res.status(400).json({ error: 'File exceeds 100MB limit' });
    }

    const desiredFileName = req.body.desiredName || req.file.originalname;
    const month = req.body.month;
    if (!month) return res.status(400).json({ error: 'Month folder not provided' });

    const yearShort = month.slice(-2);
    const year = `20${yearShort}`;
    const folderPath = ['Packs', year, month];

    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `mega-upload-${Date.now()}-${desiredFileName}`);

    try {
        fs.writeFileSync(tempFilePath, req.file.buffer);
        const storage = await getMegaStorage();
        const targetFolder = await getOrCreateFolder(storage.root, folderPath);
        const readStream = fs.createReadStream(tempFilePath);

        const uploadResult = await new Promise((resolve, reject) => {
            const upload = targetFolder.upload({ name: desiredFileName, size: req.file.size }, readStream);
            upload.on('error', reject);
            upload.on('complete', resolve);
        });

        const megaLink = await uploadResult.link();
        console.log(`✅ Uploaded to Mega: ${megaLink}`);

        let localPath = null;
        // optional local download – if it fails, we still return success
        if (req.body.downloadAfterUpload === 'true') {
            try {
                const downloadDir = req.body.localDownloadPath || './downloads/';
                if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

                const { File } = require('megajs');
                const megaFile = File.fromURL(megaLink);
                const localFile = path.join(downloadDir, desiredFileName);

                await new Promise((resolve, reject) => {
                    const writeStream = fs.createWriteStream(localFile);
                    megaFile.download((err, data) => {
                        if (err) return reject(err);
                        writeStream.write(data);
                        writeStream.end();
                        writeStream.on('finish', resolve);
                        writeStream.on('error', reject);
                    });
                });
                localPath = localFile;
            } catch (downloadErr) {
                console.warn('⚠️ Optional local download failed, continuing:', downloadErr.message);
                // not fatal – we already have the MEGA link
            }
        }

        fs.unlinkSync(tempFilePath);

        res.json({
            success: true,
            link: megaLink,
            localPath: localPath,
            fileName: desiredFileName
        });
    } catch (error) {
        console.error('MEGA operation error:', error);
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        res.status(500).json({ error: error.message || 'Upload failed' });
    }
});
