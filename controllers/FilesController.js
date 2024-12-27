const mime = require('mime-types');
const path = require('path');
const fs = require('fs');
const Queue = require('bull');

const fileQueue = new Queue('fileQueue');
const { ObjectId } = require('mongodb');
const { v4: uuidv4 } = require('uuid'); // For generating tokens
// const sha1 = require('sha1');// For hashing the password

const dbClient = require('../utils/db'); // MongoDB client
const redisClient = require('../utils/redis'); // Redis client

exports.postUpload = async function postUpload(req, res) {
  try {
    console.log('Inside postUpload');
    const token = req.headers['x-token'];

    // Check if token is provided
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Retrieve the user ID from Redis using the token
    const userId = await redisClient.get(`auth_${token}`);

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Retrieve user from the database
    const db = dbClient.getDb(); // Get the database instance
    const user = await db.collection('users').findOne({ _id: ObjectId(userId) }); // Use ObjectId here

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Proceed with file creation
    const {
      name, type, parentId = 0, isPublic = false, data,
    } = req.body;

    // Validate name
    if (!name) {
      return res.status(400).json({ error: 'Missing name' });
    }

    // Validate type
    const validTypes = ['file', 'folder', 'image'];
    if (!type || !validTypes.includes(type)) {
      return res.status(400).json({ error: 'Missing type' });
    }

    // Validate data (for file/image types)
    if (type !== 'folder' && !data) {
      return res.status(400).json({ error: 'Missing data' });
    }

    // Validate parentId if provided
    let parentFile = null;
    if (parentId !== 0) {
      parentFile = await db.collection('files').findOne({ _id: ObjectId(parentId) }); // Use ObjectId here
      if (!parentFile) {
        return res.status(400).json({ error: 'Parent not found' });
      }

      if (parentFile.type !== 'folder') {
        return res.status(400).json({ error: 'Parent is not a folder' });
      }
    }

    if (type === 'folder') {
      const newFile = {
        userId: ObjectId(userId), // Use ObjectId here
        name,
        type,
        isPublic,
        parentId: parentId === 0 ? 0 : ObjectId(parentId), // Use ObjectId here
      };

      const result = await db.collection('files').insertOne(newFile);
      return res.status(201).json({
        id: result.insertedId,
        userId,
        name,
        type,
        isPublic,
        parentId,
      });
    }

    const FOLDER_PATH = process.env.FOLDER_PATH || '/tmp/files_manager';
    // eslint-disable-next-line global-require
    const fs = require('fs');
    // eslint-disable-next-line global-require
    const path = require('path');

    // Ensure the folder exists
    if (!fs.existsSync(FOLDER_PATH)) {
      fs.mkdirSync(FOLDER_PATH, { recursive: true });
    }

    // Generate a unique file name using UUID
    const fileUUID = uuidv4();
    const localPath = path.join(FOLDER_PATH, fileUUID);

    // Decode the Base64 data
    const fileData = Buffer.from(data, 'base64');

    // Write the file to the local file system
    fs.writeFileSync(localPath, fileData);

    // Create the file document
    const newFile = {
      userId: ObjectId(userId),
      name,
      type,
      isPublic,
      parentId: parentId === 0 ? 0 : ObjectId(parentId),
      localPath,
    };

    // Insert into the database
    const result = await db.collection('files').insertOne(newFile);

    // Add the job to the Bull queue for image thumbnail processing
    if (type === 'image') {
      await fileQueue.add({
        userId,
        fileId: result.insertedId.toString(),
      });
    }
    return res.status(201).json({
      id: result.insertedId,
      userId,
      name,
      type,
      isPublic,
      parentId,
    });
  } catch (error) {
    console.error('Error in postUpload:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getShow = async function getShow(req, res) {
  try {
    console.log('Inside getShow');

    // Retrieve token from headers
    const token = req.headers['x-token'];

    // Check if token is provided
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Retrieve the user ID from Redis using the token
    const userId = await redisClient.get(`auth_${token}`);

    // Check if the user is authenticated
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Retrieve the user from the database
    const db = dbClient.getDb();
    const user = await db.collection('users').findOne({ _id: ObjectId(userId) });

    // If no user found, return unauthorized
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get file ID from the request params
    const fileId = req.params.id;

    // // Validate the file ID format (e.g., must be a valid ObjectId)
    // if (!ObjectId.isValid(fileId)) {
    //   return res.status(400).json({ error: 'Invalid file ID' });
    // }

    // Retrieve the file document from the database
    const file = await db.collection('files').findOne({
      _id: ObjectId(fileId),
      userId: ObjectId(userId),
    });

    // Check if the file exists and belongs to the user
    if (!file) {
      return res.status(404).json({ error: 'Not Found' });
    }

    // If the file is found, return the file document
    return res.status(200).json({
      id: file._id,
      userId: file.userId,
      name: file.name,
      type: file.type,
      isPublic: !!file.isPublic,
      parentId: file.parentId,
    });
  } catch (error) {
    console.error('Error in getShow:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getIndex = async function getIndex(req, res) {
  try {
    console.log('Inside getIndex');

    // Retrieve token from headers
    const token = req.headers['x-token'];

    // Check if token is provided
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Retrieve the user ID from Redis using the token
    const userId = await redisClient.get(`auth_${token}`);

    // Check if the user is authenticated
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Retrieve the user from the database
    const db = dbClient.getDb();
    const user = await db.collection('users').findOne({ _id: ObjectId(userId) });

    // If no user found, return unauthorized
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Retrieve parentId and page from query parameters (parentId defaults to 0 if not provided)
    const parentId = req.query.parentId || '0'; // Default to '0' for root
    const page = parseInt(req.query.page, 10) || 0; // Default to page 0 if not provided

    // Pagination logic: 20 items per page
    const pageSize = 20;
    const skip = page * pageSize;

    // Query the files collection for documents linked to the user and the specific parentId
    const files = await db.collection('files')
      .find({
        userId: ObjectId(userId), // Files linked to the authenticated user
        parentId: parentId === '0' ? 0 : ObjectId(parentId), // If parentId is '0', match root files, otherwise match parent folder
      })
      .skip(skip) // Skip documents for pagination
      .limit(pageSize) // Limit to 20 documents
      .toArray(); // Convert the cursor to an array

    // Return the list of files (can be empty if no files are found)
    return res.status(200).json(
      files.map((file) => ({
        id: file._id,
        userId: file.userId,
        name: file.name,
        type: file.type,
        isPublic: !!file.isPublic,
        parentId: file.parentId,
      })),
    );
  } catch (error) {
    console.error('Error in getIndex:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

exports.putPublish = async function putPublish(req, res) {
  try {
    console.log('Inside putPublish');

    // Retrieve token from headers
    const token = req.headers['x-token'];

    // Check if token is provided
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Retrieve the user ID from Redis using the token
    const userId = await redisClient.get(`auth_${token}`);

    // Check if the user is authenticated
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Retrieve the user from the database
    const db = dbClient.getDb();
    const user = await db.collection('users').findOne({ _id: ObjectId(userId) });

    // If no user found, return unauthorized
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Retrieve the file ID from the request parameters
    const fileId = req.params.id;

    // Find the file linked to the user
    const file = await db.collection('files').findOne({ _id: ObjectId(fileId), userId });

    // Check if file exists
    if (!file) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Update the file's isPublic status to true
    await db.collection('files').updateOne(
      { _id: ObjectId(fileId) },
      { $set: { isPublic: true } },
    );

    // Return the updated file document
    const updatedFile = await db.collection('files').findOne({ _id: ObjectId(fileId) });
    return res.status(200).json(updatedFile);
  } catch (error) {
    console.error('Error in putPublish:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

// New putUnpublish method
exports.putUnpublish = async function putUnpublish(req, res) {
  try {
    console.log('Inside putUnpublish');

    // Retrieve token from headers
    const token = req.headers['x-token'];

    // Check if token is provided
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Retrieve the user ID from Redis using the token
    const userId = await redisClient.get(`auth_${token}`);

    // Check if the user is authenticated
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Retrieve the user from the database
    const db = dbClient.getDb();
    const user = await db.collection('users').findOne({ _id: ObjectId(userId) });

    // If no user found, return unauthorized
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Retrieve the file ID from the request parameters
    const fileId = req.params.id;

    // Find the file linked to the user
    const file = await db.collection('files').findOne({ _id: ObjectId(fileId), userId });

    // Check if file exists
    if (!file) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Update the file's isPublic status to false
    await db.collection('files').updateOne(
      { _id: ObjectId(fileId) },
      { $set: { isPublic: false } },
    );

    // Return the updated file document
    const updatedFile = await db.collection('files').findOne({ _id: ObjectId(fileId) });
    return res.status(200).json(updatedFile);
  } catch (error) {
    console.error('Error in putUnpublish:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.getFile = async function getFile(req, res) {
  try {
    console.log('Inside getFile');

    // Retrieve token from headers
    const token = req.headers['x-token'];

    // Check if token is provided
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Retrieve the user ID from Redis using the token
    const userId = await redisClient.get(`auth_${token}`);

    // Check if the user is authenticated
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Retrieve the user from the database
    const db = dbClient.getDb();
    const user = await db.collection('users').findOne({ _id: ObjectId(userId) });

    // If no user found, return unauthorized
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Retrieve the file ID from the request parameters
    const fileId = req.params.id;

    // Find the file linked to the user
    const file = await db.collection('files').findOne({ _id: ObjectId(fileId), userId: ObjectId(userId) });

    // Check if file exists
    if (!file) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Check if the file is a folder (folders don't have content)
    if (file.type === 'folder') {
      return res.status(400).json({ error: "A folder doesn't have content" });
    }

    // If the file is not public and the user is not the owner, return 404
    if (!file.isPublic && file.userId.toString() !== userId.toString()) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Check for size query parameter (allowed sizes: 500, 250, 100)
    const { size } = req.query;
    const allowedSizes = [500, 250, 100];
    let filePath = file.localPath; // Default to the original file path

    if (size && allowedSizes.includes(parseInt(size, 10))) {
      // Modify the file path to point to the thumbnail
      filePath = `${file.localPath}_${size}`;
    }

    // Build the full path to the file
    const fullPath = path.join('/tmp/files_manager/', filePath);

    // Check if the file exists on disk
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Get the MIME-type based on the file name
    const mimeType = mime.lookup(file.name);

    // Read the file's content
    const fileContent = fs.readFileSync(fullPath);

    // Return the content of the file with the correct MIME-type
    res.setHeader('Content-Type', mimeType);
    return res.status(200).send(fileContent);
  } catch (error) {
    console.error('Error in getFile:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
