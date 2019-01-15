const WebSocket = require('ws')
const http = require('http')
const url = require('url')
const Promise = require('bluebird')
const Eos = require('eosjs')
const { URL } = require('url')
const axios = require('axios')
const _ = require('underscore')
const sslChecker = require('ssl-checker')

const seconds = 1000
axios.defaults.timeout = 3 * seconds

const config = {
  httpEndpoint: 'https://jungle2.cryptolions.io',
  chainId: 'e70aaab8997e1dfce58fbfac80cbbb8fecec7b99cf982a9444273cbc64c41473',
  contract: 'priveosrules',
}

const eos = Eos({httpEndpoint: config.httpEndpoint, chainId: config.chainId})
const server = http.createServer()
server.listen(9091, "127.0.0.1")

// define some websocket functions
const wss = new WebSocket.Server({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  const pathname = url.parse(request.url).pathname

  if (pathname === '/live') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  if(latest_data) {
    ws.send(latest_data)    
  }
})

let latest_data
async function node_check() {
  const nodes = await get_nodes()
  
  const promises = nodes.map(async node => {
    const url = new URL('/broker/status/', node.url)
    try {
      return await check_node(url)
    } catch(e) {
      // console.log(e)
      return 'connection failed'
    }
  })
  const responses = await Promise.all(promises)
  const node_states = _.zip(nodes, responses)
  
  // console.log(node_states)
  latest_data = JSON.stringify(node_states, null, 2)
  broadcast(wss, latest_data)
}

async function check_node(url) {
  let errors = []
  let warnings = []
  const [ssl_result, status_result] = await Promise.all([
    sslChecker(url.host),
    check_status(url),
  ])
  
  
  if(!ssl_result.valid) {
    status_result.errors.push('SSL Certificate is invalid')
  }
  if(ssl_result.days_remaining < 10) {
    add_warning(status_result, `SSL certificate expires in ${ssl_result.days_remaining} days. Please renew.`)
  }
  return status_result
}
function add_warning(status, warning) {
  if(!status.warnings) {
    status.warnings = []
  }
  status.warnings.push(warning)
  
}
async function check_status(url) {
  const res = await axios.get(url.href)
  return res.data  
}

async function broadcast(socket, data) {
  socket.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  })
}

async function get_nodes() {
  const res = await eos.getTableRows({json:true, scope: config.contract, code: config.contract,  table: 'nodes', limit:100})
  return res.rows.filter(x => x.is_active)
}

node_check()
setInterval(node_check, 10 * seconds)

