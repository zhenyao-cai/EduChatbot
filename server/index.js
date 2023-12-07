const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { OpenAI } = require("openai");
const ChatBot = require("./chatbot/chatbot.js");
// Initialize the express application
const app = express();

// Create an HTTP server
const server = http.createServer(app);

// Initialize socket.io
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    }
});

// Lobby management
const lobbies = {};

// Function to generate a unique 4-character GUID
// We can modify this to be whatever we want.
function generateGUID() {
    return Math.random().toString(36).substring(2, 6);
}

// Socket.io logic
io.on('connection', (socket) => {
    // Lobby creation
    socket.on('createLobby', async (username) => {
        const guid = generateGUID();
        // lobbies[guid] = {
        //     //chatroomName: "",
        //     hostUserame: username,
        //     users: { [username]: socket.id }, // dictionary of users
        //     //chatStartedTime: -1, // unix time used to get running time by subtracting current time minus this
        //     //chatbot: null,
        //     //botSettings: {
        //     //assertiveness: -1,
        //     //botName: "",
        //     //topicName: "",
        //     //},
        // };
        
        console.log("Guid: ", guid);
        console.log(io.sockets.adapter.rooms);
        socket.join(guid);
        console.log(io.sockets.adapter.rooms);

        const roomExists = io.sockets.adapter.rooms.has(guid);
        console.log(roomExists);

        lobbies[guid] = { users: {}, roomStarted: false, botInitialized: false, hostUserame: username, chatbot: null };
        //socket.join(guid);
        lobbies[guid].users[username] = 0;
        socket.emit('lobbyCreated', guid);
        //console.log(` > CREATING LOBBY: ${guid}, host: ${username}`);
        //console.log(lobbies);
        //console.log(` > LOBBY CREATED`);
    });

    socket.on('testBroadcast', () => {
        const testMessage = "This is a test message to all users.";
        io.emit('message', { sender: 'Server', text: testMessage });
        console.log(` > BROADCASTING TEST MESSAGE TO ALL USERS`);
    });

    // Joining a lobby
    socket.on('joinLobby', async (guid, username) => {
        console.log(` > Request to join: ${guid} by user: ${username}`);
        // console.log(lobbies);
        if (lobbies[guid] && !lobbies[guid].users[username]) {
            socket.join(guid);
            lobbies[guid].users[username] = 0;
            socket.emit('joinedLobby', guid);
            io.to(guid).emit('userJoinedLobby', username);
        } else {
            socket.emit('lobbyError', 'Error joining lobby');
        }
    });

    socket.on('joinRoom', async (guid, username) => {
        console.log(` > Joining Chatroom: ${guid} by user: ${username}`);

        if (lobbies[guid] && lobbies[guid].users[username] == 0) {
            socket.join(guid);
            socket.emit('joinedChatroom', guid);
        } else {
            socket.emit('chatroomError', 'Error joining room.');
        }
    })

    // Sending messages within a lobby
    // this is the primary change to make lobbies work, we use
    // .to(guid) to point the message at the correct chatroom.
    // be sure to do the same with the chatbot messages so they
    // end up in the correct room.
    socket.on('lobbyMessage', async (guid, messageData) => {

        // console.log(lobbies);
        if (lobbies[guid]) {
            io.to(guid).emit('message', messageData);
            console.log(` > BROADCASTING: ${messageData.text} FROM: ${messageData.sender}; TO: ${lobbies[guid].users[lobbies[guid].hostUserame]}`);

            let respond = await lobbies[guid].chatbot.botMessageListener(messageData.sender, messageData.text);

            if (respond) {
                io.to(guid).emit('message', { sender: lobbies[guid].chatbot.botname, text: respond });
            }
        }
    });

    // pass in a lobbyID, and get back the host name of the lobby
    socket.on('getHostName', async (guid) => {
        if (lobbies[guid]) {
            const hostName = lobbies[guid].hostUsername;
            // Sending back an object with the host name
            socket.emit('hostNameResponse', { hostName });
        } else {
            // Handle the case where the lobby doesn't exist
            socket.emit('hostNameResponse', { error: 'Lobby not found' });
        }
    });

    socket.on('updateBotSettings', async (guid, lobbyData) => {
        if (lobbies[guid]) {
            socket.to(guid).emit('chatStarted');
            lobbies[guid].roomStarted = true;

            if (!lobbies[guid].botInitialized) {
                console.log(` > LOBBY STARTED, CODE: ${guid}`);

                let chatbotInstance = new ChatBot(Object.keys(lobbies[guid].users), lobbyData.topic, lobbyData.botname, lobbyData.assertiveness);
                let success = await chatbotInstance.initializePrompting();
                // TODO : ERROR HANDLING
                //console.log(success);
                let botPrompt = await chatbotInstance.getInitialQuestion();
                //console.log(botPrompt);
                io.to(guid).emit('message', { text: botPrompt, sender: chatbotInstance.botname });
                lobbies[guid].botInitialized = true;
                // console.log(lobbies[guid]);
                lobbies[guid].chatbot = chatbotInstance;
                console.log(` > LOBBY STARTED!`);
            }
        }
    });

    // returns a list of users in the lobby
    socket.on('getUserListOfLobby', async (guid) => {
        if (lobbies[guid] && lobbies[guid].users) {
            // Get all usernames from the 'users' object
            const userList = Object.keys(lobbies[guid].users);

            // Send back the list of usernames
            socket.emit('userListOfLobbyResponse', { userList });
        } else {
            // Handle the case where the lobby doesn't exist or has no users
            socket.emit('userListOfLobbyResponse', { error: 'Lobby not found or no users in lobby' });
        }
    });

    // Leaving a lobby
    socket.on('leaveLobby', (guid, username) => {
        if (lobbies[guid] && lobbies[guid].users[username]) {
            socket.leave(guid);
            delete lobbies[guid].users[username];
            if (Object.keys(lobbies[guid].users).length === 0) {
                delete lobbies[guid]; // Delete the lobby if empty
            }
            socket.emit('leftLobby', guid);
            io.to(guid).emit('userLeftLobby', username);
        }
    });

    // Disconnect logic
    socket.on('disconnect', () => {
        // Iterate through all lobbies to remove the disconnected user
        for (const guid in lobbies) {
            if (lobbies[guid].users[socket.username]) {
                delete lobbies[guid].users[socket.username];
                if (Object.keys(lobbies[guid].users).length === 0) {
                    delete lobbies[guid]; // Delete the lobby if empty
                }
                io.to(guid).emit('userLeftLobby', socket.username);
            }
        }
    });
});

// Start the server
const port = process.env.PORT || 4000;
server.listen(port, () => console.log(`Listening on port ${port}`));