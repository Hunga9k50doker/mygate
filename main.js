import WebSocket from "ws";
import axios from "axios";
import { randomUUID } from "crypto";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import fs from "fs";
import log from "./utils/logger.js";
import bedduSalama from "./utils/banner.js";

const headers = {
  Accept: "application/json, text/plain, */*",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
  Origin: "https://app.mygate.network",
  Priority: "u=1, i",
  Referer: "https://app.mygate.network/",
  "Sec-CH-UA": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  "Sec-CH-UA-Mobile": "?0",
  "Sec-CH-UA-Platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

function readFile(pathFile) {
  try {
    const datas = fs
      .readFileSync(pathFile, "utf8")
      .split("\n")
      .map((data) => data.trim())
      .filter((data) => data.length > 0);
    return datas;
  } catch (error) {
    log.error(`Error reading file: ${error.message}`);
    return [];
  }
}

function decodeJWT(jwt) {
  // Split the JWT into its components
  const [header, payload, signature] = jwt.split(".");

  // Decode the header
  const decodedHeader = JSON.parse(atob(header.replace(/-/g, "+").replace(/_/g, "/")));

  // Decode the payload
  const decodedPayload = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));

  return { decodedHeader, decodedPayload };
}

const newAgent = (proxy = null) => {
  if (proxy && proxy.startsWith("http://")) {
    const agent = new HttpsProxyAgent(proxy);
    return agent;
  } else if (proxy && proxy.startsWith("socks4://")) {
    const agent = new SocksProxyAgent(proxy);
    return agent;
  } else if (proxy && proxy.startsWith("socks5://")) {
    const agent = new SocksProxyAgent(proxy);
    return agent;
  } else {
    return null;
  }
};

class WebSocketClient {
  constructor(token, proxy = null, uuid, reconnectInterval = 5000) {
    this.token = token;
    this.proxy = proxy;
    this.socket = null;
    this.reconnectInterval = reconnectInterval;
    this.shouldReconnect = true;
    this.agent = newAgent(proxy);
    this.uuid = uuid;
    this.url = `wss://api.mygate.network/socket.io/?nodeId=${this.uuid}&EIO=4&transport=websocket`;
    this.regNode = `40{"token":"Bearer ${this.token}"}`;
    this.headers = {
      "Accept-encoding": "gzip, deflate, br, zstd",
      "Accept-language": "en-US,en;q=0.9,id;q=0.8",
      "Cache-control": "no-cache",
      Connection: "Upgrade",
      Host: "api.mygate.network",
      Origin: "chrome-extension://hajiimgolngmlbglaoheacnejbnnmoco",
      Pragma: "no-cache",
      "Sec-Websocket-Extensions": "permessage-deflate; client_max_window_bits",
      Upgrade: "websocket",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    };
  }

  connect() {
    if (!this.uuid || !this.url) {
      log.error("Cannot connect: Node is not registered.");
      return;
    }

    log.info("Attempting to connect:", this.uuid);
    this.socket = new WebSocket(this.url, { headers: this.headers, agent: this.agent });

    this.socket.onopen = () => {
      log.info("WebSocket connection established for node:", this.uuid);
      this.reply(this.regNode);
    };

    this.socket.onmessage = (event) => {
      if (event.data === "2" || event.data === "41") this.socket.send("3");
      else log.info(`Node ${this.uuid} received message:`, event.data);
    };

    this.socket.onclose = () => {
      log.warn("WebSocket connection closed for node:", this.uuid);
      if (this.shouldReconnect) {
        log.warn(`Reconnecting in ${this.reconnectInterval / 1000} seconds for node:`, this.uuid);
        setTimeout(() => this.connect(), this.reconnectInterval);
      }
    };

    this.socket.onerror = (error) => {
      log.error(`WebSocket error for node ${this.uuid}:`, error.message);
      this.socket.close();
    };
  }

  reply(message) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(String(message));
      const { decodedPayload } = decodeJWT(this.token);
      const { name, email, exp } = decodedPayload;
      const mess = `User: ${name} | email: ${email} | Token isexpired:${Date.now() / 1000 > exp}`;
      log.info("Replied with: ", mess);
    } else {
      log.error("Cannot send message; WebSocket is not open.");
    }
  }

  disconnect() {
    this.shouldReconnect = true;
    if (this.socket) {
      this.socket.close();
    }
  }
}

async function registerNode(token, proxy = null, node = null) {
  const agent = newAgent(proxy);
  const maxRetries = 5;
  let retries = 0;
  let uuid = node || randomUUID();
  const activationDate = new Date().toISOString();
  const payload = {
    id: uuid,
    status: "Good",
    activationDate: activationDate,
  };

  while (retries < maxRetries) {
    try {
      const response = await axios.post("https://api.mygate.network/api/front/nodes", payload, {
        headers: {
          ...headers,
          Authorization: `Bearer ${token}`,
        },
        agent: agent,
      });

      log.info("Node registered successfully:", response.data);
      return uuid;
    } catch (error) {
      log.error("Error registering node:", error.message);
      retries++;
      if (retries < maxRetries) {
        log.info("Retrying in 10 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 10000));
      } else {
        log.error("Max retries exceeded; giving up on registration.");
        return null;
      }
    }
  }
}

async function confirmUser(token, proxy = null) {
  const agent = newAgent(proxy);
  try {
    const response = await axios.post(
      "https://api.mygate.network/api/front/referrals/referral/LfBWAQ?",
      {},
      {
        headers: {
          ...headers,
          Authorization: `Bearer ${token}`,
        },
        agent: agent,
      }
    );
    log.info("Confirm user response:", response.data);
    return null;
  } catch (error) {
    log.info("confirming user:", error.message);
    return null;
  }
}

const getQuestsList = async (token, proxy = null) => {
  const maxRetries = 5;
  let retries = 0;
  const agent = newAgent(proxy);

  while (retries < maxRetries) {
    try {
      const response = await axios.get("https://api.mygate.network/api/front/achievements/ambassador", {
        headers: {
          ...headers,
          Authorization: `Bearer ${token}`,
        },
        agent: agent,
      });
      const uncompletedIds = response.data.data.items.filter((item) => item.status === "UNCOMPLETED").map((item) => item._id);
      return uncompletedIds;
    } catch (error) {
      retries++;
      if (retries < maxRetries) {
        log.info("Retrying in 10 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 10000));
      } else {
        log.error("Max retries exceeded; giving up on getting quest info.");
        return { error: error.message };
      }
    }
  }
};

async function submitQuest(token, proxy = null, questId) {
  const maxRetries = 5;
  let retries = 0;
  const agent = newAgent(proxy);
  while (retries < maxRetries) {
    try {
      const response = await axios.post(
        `https://api.mygate.network/api/front/achievements/ambassador/${questId}/submit?`,
        {},
        {
          headers: {
            ...headers,
            Authorization: `Bearer ${token}`,
          },
          agent: agent,
        }
      );
      log.info("Submit quest response:", response.data);
      return response.data;
    } catch (error) {
      log.error("Error submit quest:", error.message);
      retries++;
      if (retries < maxRetries) {
        log.info("Retrying in 10 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 10000));
      } else {
        log.error("Max retries exceeded; giving up on getting quest info.");
        return { error: error.message };
      }
    }
  }
}

async function getUserInfo(token, proxy = null) {
  const maxRetries = 5;
  let retries = 0;
  const agent = newAgent(proxy);

  while (retries < maxRetries) {
    try {
      const response = await axios.get("https://api.mygate.network/api/front/users/me", {
        headers: {
          ...headers,
          Authorization: `Bearer ${token}`,
        },
        agent: agent,
      });
      const { name, status, _id, levels, currentPoint } = response.data.data;
      return { name, status, _id, levels, currentPoint };
    } catch (error) {
      retries++;
      if (retries < maxRetries) {
        log.info("Retrying in 10 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 10000));
      } else {
        log.error("Max retries exceeded; giving up on getting user info.");
        return { error: error.message };
      }
    }
  }
}

async function getUserNode(token, proxy = null, index) {
  const maxRetries = 5;
  let retries = 0;
  const agent = newAgent(proxy);

  while (retries < maxRetries) {
    try {
      const response = await axios.get("https://api.mygate.network/api/front/nodes?limit=10&page=1", {
        headers: {
          ...headers,
          Authorization: `Bearer ${token}`,
        },
        agent: agent,
      });

      return response.data.data.items.map((item) => item.id);
    } catch (error) {
      retries++;

      if (error.response && error.response.status === 401) {
        log.error(`Account #${index}:`, "Unauthorized - please update token");
        return null;
      }

      if (retries < maxRetries) {
        log.info("Retrying in 10 seconds...");
        await new Promise((resolve) => setTimeout(resolve, 10000));
      } else {
        log.error("Max retries exceeded; giving up on getting user nodes.");
        return [];
      }
    }
  }
}

const checkQuests = async (token, proxy = null) => {
  log.info("Trying to check for new quests...");
  const questsIds = await getQuestsList(token, proxy);

  if (questsIds && questsIds.length > 0) {
    log.info("Found new uncompleted quests:", questsIds.length);

    for (const questId of questsIds) {
      log.info("Trying to complete quest:", questId);
      try {
        await submitQuest(token, proxy, questId);
        log.info(`Quest ${questId} completed successfully.`);
      } catch (error) {
        log.error(`Error completing quest ${questId}:`, error);
      }
    }
  } else {
    log.info("No new uncompleted quests found.");
  }
};

async function main() {
  log.info(bedduSalama);

  const tokens = readFile("tokens.txt");
  const proxies = readFile("proxy.txt");
  let proxyIndex = 0;

  try {
    log.info(`Processing run with total ${tokens.length} accounts`);
    await Promise.all(
      tokens.map(async (token, index) => {
        const proxy = proxies.length > 0 ? proxies[proxyIndex] : null;
        if (proxies.length > 0) {
          proxyIndex = (proxyIndex + 1) % proxies.length;
        }

        log.info("Trying to get user nodes for account", `#${index + 1}`);
        let nodes = await getUserNode(token, proxy, index + 1);
        if (!nodes) return;
        if (nodes.length === 0) {
          log.info("This account has no nodes - registering new node...");
          const uuid = await registerNode(token, proxy);
          if (!uuid) {
            log.error("Failed to register node - skipping WebSocket connection.");
            return;
          }
          nodes = [uuid];
        } else {
          log.info(`Active user nodes for account #${index + 1}:`, nodes.length);
          await Promise.all(nodes.map((node) => registerNode(token, proxy, node)));
        }

        await confirmUser(token, proxy);
        setInterval(async () => {
          const { name, status, levels, currentPoint } = await getUserInfo(token);
          const message = `Name: ${name} | Active nodes: ${nodes.length} | Level: ${levels} | Points: ${currentPoint}`;
          log.info(`User info for account #${index + 1}:`, message);
        }, 11 * 60 * 1000); // Get user info every 11 minutes

        await Promise.all(
          nodes.map((node) => {
            log.info(`Trying to open new connection for account #${index + 1} using proxy:`, proxy || "No Proxy");
            const client = new WebSocketClient(token, proxy, node);
            client.connect();

            setInterval(() => {
              client.disconnect();
            }, 10 * 60 * 1000); // Auto reconnect node every 10 minutes
          })
        );

        await checkQuests(token, proxy);
        setInterval(async () => {
          try {
            await checkQuests(token, proxy);
          } catch (error) {
            log.error(`Error checking quests for account #${index + 1}:`, error.message);
          }
        }, 24 * 60 * 60 * 1000); // Check quests every 24 hours

        const { name, status, levels, currentPoint } = await getUserInfo(token, proxy);
        const message = `Name: ${name} | Active nodes: ${nodes.length} | Level: ${levels} | Points: ${currentPoint}`;
        log.info(`User info for account #${index + 1}:`, message);
      })
    );

    log.info("All accounts connections established - Waiting 10 minutes to next ping.");
  } catch (error) {
    log.error("Error in WebSocket connections:", error.message);
  }
}

main();
