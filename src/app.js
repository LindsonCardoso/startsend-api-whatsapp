const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');

const fileUpload = require('express-fileupload');
const { phoneNumberFormatter } = require('../helpers/formatter');
//const axios = require('axios');
const port = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));


app.use(fileUpload({
  debug: false
}));

app.get('/', (req, res) => {
  res.sendFile('./viewes/index.html', {
    root: __dirname
  });
});

app.get('/instancias', (req, res) => {
  res.sendFile('./viewes/server.html', {
    root: __dirname
  });
});

app.get('/home', (req, res) => {
  res.sendFile('./viewes/home.html', {
    root: __dirname
  });
});

app.get('/multi', (req, res) => {
    res.sendFile('./viewes/index-multiple-account.html', {
      root: __dirname
    });
});


/**
 * Funções de criação das instacias e afins
 * 
**/

const sessions = [];
const SESSIONS_FILE = './whatsapp-sessions.json';

const createSessionsFileIfNotExists = function() {
  if (!fs.existsSync(SESSIONS_FILE)) {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      console.log('Sessions file created successfully.');
    } catch(err) {
      console.log('Failed to create sessions file: ', err);
    }
  }
}; createSessionsFileIfNotExists();

const setSessionsFile = function(sessions) {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function(err) {
    if (err) {
      console.log("fuc setSessionsFile "+ err);
    }
  });
};

const getSessionsFile = function() {
  return JSON.parse(fs.readFileSync(SESSIONS_FILE));
};

const createSession = function(id, description) {

  console.log('Creating session: ' + id);

    const client = new Client({
      restartOnAuthFail: true,
      puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // <- this one doesn't works in Windows
        '--disable-gpu'
        ],
      },
      authStrategy: new LocalAuth({
        clientId: id,
        dataPath: 'C:/Users/l/PDEV/NODEJS/dataPath'
      })

    });

  client.initialize();

  client.on('qr', (qr) => {
  console.log('\n');
  qrcode.toDataURL(qr, (err, url) => {
    io.emit('qr', { id: id, src: url });
    io.emit('message', { id: id, text: 'QR Code pronto, leia, por favor!' });
  });

  });

  client.on('ready', () => {

  io.emit('ready', { id: id });
  io.emit('message', { id: id, text: 'Whatsapp está pronto!' });
  
  console.log(JSON.stringify(id) + ' READY' +'\n' );

  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
  savedSessions[sessionIndex].ready = true;
  setSessionsFile(savedSessions);

  });

  client.on('authenticated', () => {

  io.emit('authenticated', { id: id });
  io.emit('message', { id: id, text: 'Whatsapp esta autenticado!'});
  console.log('\n' +  JSON.stringify(id) + ' AUTHENTICATED');
  
  });

  client.on('auth_failure', function() {
  io.emit('message', { id: id, text: 'Auth failure, restarting...' });
  console.error('AUTHENTICATION FAILURE');
  });

  client.on('disconnected', () => {
    io.emit('message', { id: id, text: 'Whatsapp is disconnected!' });
  
    client.destroy();

    //variavel para comparar com sender 
    var idUser = id;
    console.log('DISCONECTED ' + idUser);

    const SESSION_PATH = `C:/Users/l/PDEV/NODEJS/dataPath/session-${id}`; //id da pasta 
    console.log('Dados da pasta ' + SESSION_PATH);

    //--- exclir pasta do ..ww
    fs.rm(SESSION_PATH, { 
        recursive: true,
        force: true
    },(err) => {
        if (err) {
          console.log('erro ao deletar  #' + err);
        }else {
          console.log('Pasta de [ ' + sender + ' ] deletada!'); 
        }
      });
      
      client.initialize();

    //--- Retirar do Whatsapp-session.json
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions.splice(sessionIndex, 1);
    setSessionsFile(savedSessions);
    
  //--- Retirar do Whatsapp-session.json
    io.emit('remove-session', id);
  });

  // Tambahkan client ke sessions
  sessions.push({
    id: id,
    description: description,
    client: client
  });

  // Menambahkan session ke file
  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);  

  if (sessionIndex == -1) {
  savedSessions.push({
    id: id,
    description: description,
    ready: false,
  });
  setSessionsFile(savedSessions);
  }

}//fim da função cread client


const init = function(socket) {
 const savedSessions = getSessionsFile(); 
  if (savedSessions.length > 0) {
    if (socket) {
      savedSessions.forEach((e, i, arr) => {
        arr[i].ready = false;
      });
      socket.emit('init', savedSessions);
    } else {
      savedSessions.forEach(sess => {
        createSession(sess.id, sess.description);
      });
    }
  }
}; init(); 

// Socket IO
io.on('connection', function(socket) {
  init(socket);

  socket.on('create-session', function(data) {
    console.log('Create session: ' + data.id);
    createSession(data.id, data.description);
  });
});




/**
* Rotas
* status 
* 200 = Sucesso
* 400 = Error retorno de funcoes
* 499 = Error catchs 
* 500 = error API
* 
**/



/*---- GET's ---------------------------------------------------------------------------------------------------*/
app.get('/exec',async (req, res) => {
 let result = { "result": "ok" };
 res.status(200).send(result);
});

//Verificar se o numero tem vinculo com whatsapp
app.get('/validar-numero', async (req, res) => {
 const sender = req.body.sender;
 const number = phoneNumberFormatter(req.body.number);
 const client = sessions.find(sess => sess.id == sender).client;
 
 console.log();
   
 client.getNumberId(number).then(async function(isRegistered) {
     if(isRegistered){
       const nome = await client.getContactById(number)
       var inforTrue = {'mensagem':  'True','nome': nome.pushname || nome.verifiedName, 'number': number}
       res.send(inforTrue);
     } else {
       var inforFalse = {'mensagem':  isRegistered, 'number': number}
       res.send(inforFalse)
     }
   }).catch(err => {
     res.status(500).json({
       status: false,
       response: err
     });
   });
});

//se o cliente esta conectado
app.get('/status-client', (req, res) => {
const sender = req.body.sender;
const client = sessions.find(sess => sess.id == sender).client;

client.getState().then(function(result){
  if(!result.match("CONNECTED")) {
    res.send({'mensagem':  "Whatsapp do cliente nao conectado"});
  } else {
    res.send({'mensagem':  `Estado do cliente = ${result}`})
  }
}).catch(err => {
  res.status(499).json({
    status: false,
    response: err
  });
});
});

//
app.get('/reset-instancia', (req, res) => {
const sender = req.body.sender;

//const number = phoneNumberFormatter(req.body.number)

const client = sessions.find(sess => sess.id == sender).client;
client.resetState().then(function(result){
  if(result) {
    res.send({'mensagem':  result});
  }
}).catch(err => {
  res.status(500).json({
    status: false,
    response: err
  });
});
});
 
app.get('/client-info', async (req, res) => {
const sender = req.body.sender;
const number = phoneNumberFormatter(req.body.number)
const client = sessions.find(sess => sess.id == sender).client;

client.getContactById(number).then( async function(result){
  if (result) {
    let contactInfo = await result;
    console.log(contactInfo.pushname)
    res.send(contactInfo);
} else {
    res.send({'mensagem':  `ERROR = ${result}`})
  }
}).catch(err => {
  res.status(500).json({
    status: false,
    response: err
  });
});


/*client.getContacts().then( async function(result){
  if (result) {
    let contactInfo = await result;
    // do stuff here
    res.send(contactInfo);
} else {
    res.send({'mensagem':  `ERROR = ${result}`})
  }
}).catch(err => {
  res.status(500).json({
    status: false,
    response: err
  });
});*/
});

app.get('/getLabels', async (req, res) => {
const sender = req.body.sender;
const number = phoneNumberFormatter(req.body.number)
const client = sessions.find(sess => sess.id == sender).client;

client.isRegisteredUser(number).then( async function(result){
  if (result) {
    let contactInfo = await result;
    //console.log(contactInfo.pushname)
    res.send(contactInfo);
} else {
    res.send({'mensagem':  `ERROR = ${result}`})
  }
}).catch(err => {
  res.status(500).json({
    status: false,
    response: err
  });
});
});

app.get('/status-whatsapp', async (req, res) => {
const sender = req.body.sender;
const number = phoneNumberFormatter(req.body.number)
const client = sessions.find(sess => sess.id == sender).client;

client.getState(number).then( async function(result){
  if (result) {
    let contactInfo = await result;
    //console.log(contactInfo.pushname)
    return res.status(201).json({message: contactInfo});
} else {
    res.send({'mensagem':  `ERROR = ${result}`})
  }
}).catch(err => {
  res.status(500).json({
    status: false,
    response: err
  });
});
});







/*---- POST's ---------------------------------------------------------------------------------------------------------*/

app.post('/send-message', async (req, res) => {
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;
  console.log(sender, number, message);
  
  const client = sessions.find(sess => sess.id == sender)?.client;
 
  if(!client) {
    return res.status(422).json({
      status: false,
      message: `The sender: ${sender} is not found!` 
    })
  }
 
  const isRegisteredNumber = await client.isRegisteredUser(number);
  if(!isRegisteredNumber) {
   return res.status(422).json({
     status: false,
     message: 'The number is not registered'
   });
  }
 
  client.sendMessage(number, message).then(response => {
   res.status(200).json({
     status: true,
     response: response
   });
   }).catch(err => {
     res.status(500).json({
       status: false,
       response: err
     });
   });
});

//ENVIO DE MEDIA
app.post('/send-media', (req, res) => {

const sender  = req.body.sender;
const number  = phoneNumberFormatter(req.body.number);

const caption = req.body.caption;
const fileName   = req.body.fileName;

const media = MessageMedia.fromFilePath(`./media/${fileName}`)

const client = sessions.find(sess => sess.id == sender).client;

client.getNumberId(number).then(function(isRegistered) {
  if(isRegistered){
    var inforTrue = {'mensagem': true}
    //validar essa informação
    if(inforTrue.mensagem == true) {
      client.sendMessage(number, media, {
        caption: caption
      }).then(response => {
        res.status(200).json({
          status: true,
          response: response
        });
      }).catch(err => {
        res.status(400).json({
          status: false,
          response: err
        });
      });
    }
  } else {
    var inforFalse = {'mensagem':  isRegistered, 'number': number, 'error': 'Esse numero nao possui vinculo com whatsapp'}
    res.status(450).send(inforFalse)
  }
}).catch(err => {
  res.status(499).json({
    status: false,
    response: err
  });
});
});

app.post('/teste', (req, res) => {
const sender = req.body.sender;
const number = req.body.number;
const message = req.body.message;
console.log(sender, number, message);
});

app.post('/removeId', async (req, res)=> {
const sender = req.body.sender;
const client = sessions.find(sess => sess.id == sender).client;

//variavel para comparar com sender 
let nameId;

client.destroy();

const SESSION_PATH = `C:/Users/l/PDEV/NODEJS/dataPath/session-${sender}`; 
console.log('Dados da pasta ' + SESSION_PATH);

//--- buscando regsdo Whatsapp-session.json
const savedSessions = getSessionsFile();

//---- Percorrendo o array json pra pega id para deletar   
for (let i = 0; savedSessions.length > i; i++) if(sender == savedSessions[i].id) nameId = savedSessions[i].id;

//deletando registro do array object
console.log("disconectado e removendo id json" + JSON.stringify(savedSessions));
const sessionIndex = savedSessions.findIndex(sess => sess.id == sender);
savedSessions.splice(sessionIndex, 1);
setSessionsFile(savedSessions);

//--- exclir pasta do ..ww
if(nameId == sender){
  fs.rm(SESSION_PATH, { 
    recursive: true,
    force: true
  },(err) => {
      if (err) {
        console.log('erro ao deletar  #' + err);
      }else {
        console.log('Pasta de [ ' + sender + ' ] deletada!'); 
      }
    });
  res.status(200).json({
      status: true,
      message: 'ok'
  }); 
}else {
  var inforFalse = {'mensagem':  'ops', 'error': 'E'}
  res.status(450).send(inforFalse)  
}
});

app.post('/reset', async (req, res) => {
/**
 * Para resetar a instancia e gerar um novo qrcode essa
 * instancia devera esta autenticada
 * **/
const sender = req.body.sender;
const client = sessions.find(sess => sess.id == sender)?.client;

// Make sure the sender is exists & ready
if(!client) {
  return res.status(422).json({
    status: false,
    message: `The sender: ${sender} is not found!`
  });
}else { 

  client.destroy();

  return res.status(200).json({
    status: true,
    message: `The sender: ${sender} success!`
  });

}
/*
//variavel para comparar com sender 
let nameId;

const SESSION_PATH = `C:/Users/l/PDEV/NODEJS/dataPath/session-${sender}`; 
console.log('Dados da pasta ' + SESSION_PATH);

//--- buscando regsdo Whatsapp-session.json
const savedSessions = getSessionsFile();

//---- Percorrendo o array json pra pega id para deletar   
for (let i = 0; savedSessions.length > i; i++) if(sender == savedSessions[i].id) nameId = savedSessions[i].id;
console.log(nameId);
//--- exclir pasta do ..ww
if(nameId == sender){
  fs.rm(SESSION_PATH, { 
    recursive: true,
    force: true
  },(err) => {
      if (err) {
        console.log('erro ao deletar  #' + err);
      }else {
        console.log('Pasta de [ ' + sender + ' ] deletada!'); 
      }
    });
      res.status(200).json({
      status: true,
      message: 'ok'
  }); 
} else {
  var inforFalse = {'startus': false, 'message': 'Erro ao tentar excluir pasta'}
  res.status(450).send(inforFalse)
}
*/
});







/*Escutando porta*/
server.listen(port, function() {  
  console.log('\n');
 console.log('App running on *: ' + port + '\n');
});
