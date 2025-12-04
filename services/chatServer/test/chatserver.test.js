const WebSocket = require('ws');
const {MongoClient} = require('mongodb');
const {connectToMongo} = require('../src/index');

//Test ENV setup
process.env.PORT = 5001;
process.env.MONGO_URL = 'mongodb://mongo-test:27017';
process.env.MONGO_DB = 'testdb';
process.env.MONGO_CHATS_COLLECTION = 'chats';
process.env.MONGO_MESSAGES_COLLECTION = 'messages';

let mongo;
let db;

beforeAll(async () => { // Runs once before all tests
  mongo = new MongoClient(process.env.MONGO_URL);
  await mongo.connect();
  db = mongo.db(process.env.MONGO_DB);
  
  // Clear DB before tests
  await db.dropDatabase();

  // Create mock chat
  await db.collection('chats').insertOne({_id: 'testChat', participants: ['user1', 'user2']});

  //start websocket server
  await connectToMongo();

  //wait for a moment to ensure server is up as ws server is async but not awaited
  await new Promise(resolve => setTimeout(resolve, 1000));
});

afterAll(async () => { // Runs once after all tests
  await mongo.close();
  // Close WebSocket server if needed
});

//Test suite for chat server
describe('Chat Server WebSocket Tests', () => {
  let ws;
  
  beforeEach((done) => { // Runs before each test
    ws = new WebSocket(`ws://chatserver:${process.env.PORT}`);
    ws.on('open', () => done());
    ws.on('error', (err) =>{
      console.error('WebSocket connection error:', err);
    });
  });

  afterEach((done) => { // Runs after each test
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
      ws.on('close', () => done());
      ws.on('error', (err) =>{
        console.error('WebSocket error during close:', err);
      });
    } else {
      done();
    }});
  
  test('Should connect and receive system message', (done) => {
    ws.on('message', (data) => { // Upon connection, should receive system message
      const message = JSON.parse(data);
      expect(message.type).toBe('system-message');
      expect(message.payload.message).toBe('Connected to the chat gateway.');
      done();
    });
  });

  test('Should send and receive chat message', (done) => {
    const chatMessage = {
      type: 'chat-message',
      payload: {
        chatId: 'testChat',
        userId: 'user1',
        message: 'Hello, World!'
      }
    };

    ws.once('message', (data) => {
      const message = JSON.parse(data);
      if (message.type === 'chat-message') {
        expect(message.payload.chatId).toBe('testChat');
        expect(message.payload.userId).toBe('user1');
        expect(message.payload.message).toBe('Hello, World!');
        done();
      }
    });

    ws.send(JSON.stringify(chatMessage));
  });

  // test('Message should be persisted in MongoDB', (done) => {
  //   const chatMessage = {
  //     type: 'chat-message',
  //     payload: {
  //       chatId: 'testChat',
  //       userId: 'user2',
  //       message: 'Persist this message.'
  //     }
  //   };

  //   ws.on('message', async (data) => {
  //     const message = JSON.parse(data);
  //     if (message.type === 'chat-message') {
  //       // Check MongoDB for the persisted message
  //       const storedMessage = await db.collection('messages').findOne({message: 'Persist this message.'});
  //       expect(storedMessage).not.toBeNull();
  //       expect(storedMessage.chatId).toBe('testChat');
  //       expect(storedMessage.userId).toBe('user2');
  //       expect(storedMessage.message).toBe('Persist this message.');
  //       done();
  //     }
  //   });

  //   ws.send(JSON.stringify(chatMessage));
  // });

});
