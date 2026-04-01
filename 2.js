// 使用 Node.js 和 Express 创建转发服务器2.js n
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const e = require('express');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// MySQL 连接池配置
const pool = mysql.createPool({
  host: 'localhost',
  port: 8510,
  user: 'root',
  password: 'Uu8297636',
  database: 'radio',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// 启用CORS以允许微信小程序访问
app.use(cors({
  origin: '*',
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// 获取电台列表接口
app.get('/api/stations', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM radio_stations');

    // 转换数据库结果为所需格式
    const stations = rows.map(row => ({
      id: row.id,
      stationCode: row.station_code,
      name: row.station_name,
      description: row.station_subtitle,
      logoUrl: row.logo_url,
      category: row.category,
      audioUrl: row.audio_url,
      subtitleUrl: row.subtitle_url,
      subtitleProtocol: row.subtitle_protocol || 'SSE',
      hasSubtitle: Boolean(row.has_subtitle),
      language: row.language,
      targetLanguage: row.target_language,
      country: row.country,
      iconResId: row.iconResId
    }));

    // 构建响应数据
    const responseData = {
      success: true,
      message: null,
      data: stations
    };

    // 写入 stations.json 文件
    const stationsJsonPath = path.join(__dirname, 'stations.json');
    fs.writeFileSync(stationsJsonPath, JSON.stringify(responseData, null, 2), 'utf-8');
    console.log('stations.json 已更新');

    // 返回响应
    res.json(responseData);
  } catch (error) {
    console.error('获取电台列表失败:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      data: []
    });
  }
});

// 获取 stations.json 文件接口（带缓存优化）
let stationsJsonCache = null;
let stationsJsonMtime = null;
const stationsJsonPath = path.join(__dirname, 'stations.json');

app.get('/api/stationsjson', (req, res) => {
  try {
    // 检查文件是否存在
    if (!fs.existsSync(stationsJsonPath)) {
      return res.status(404).json({
        success: false,
        message: 'stations.json file not found. Please call /api/stations first.',
        data: null
      });
    }

    // 检查文件是否被修改
    const currentMtime = fs.statSync(stationsJsonPath).mtime.getTime();
    if (stationsJsonMtime !== currentMtime || !stationsJsonCache) {
      // 文件已修改或首次读取，重新读取
      stationsJsonCache = fs.readFileSync(stationsJsonPath, 'utf-8');
      stationsJsonMtime = currentMtime;
    }

    // 设置响应头（包含缓存控制）
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300', // 浏览器缓存5分钟
      'ETag': `"${stationsJsonMtime}"` // 使用修改时间作为ETag
    });

    // 检查客户端缓存
    const clientETag = req.headers['if-none-match'];
    if (clientETag === `"${stationsJsonMtime}"`) {
      return res.status(304).end(); // Not Modified
    }

    // 返回缓存的文件内容
    res.send(stationsJsonCache);
  } catch (error) {
    console.error('读取stations.json失败:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      data: null
    });
  }
});

// 转发音频流
app.get('/proxy-audio', async (req, res) => {
  try {
    const sourceUrl = req.query.url || 'https://1864288729.rsc.cdn77.org/1864288729/tracks-a1/mono.m3u8';
    // console.log('代理请求:', sourceUrl);
    // console.log(req.query.url);
    // console.log('res');
    
    // 获取原始流内容
    const response = await axios({
      method: 'get',
      url: sourceUrl,
      responseType: 'stream'
    });
    
    // 设置适当的响应头
    res.set({
      'Content-Type': response.headers['content-type'],
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no'
    });
    
    // 将流传输到客户端
    response.data.pipe(res);
  } catch (error) {
    console.error('代理请求失败:', error);
    res.status(500).send('代理请求失败');
  }
});

// 单入多出：每个 keyid 只维护一条到源站的连接，广播给所有监听该 keyid 的客户端
const activeStreams = new Map(); // keyid -> { clients: Set<res>, source: stream, url: string }

const streamUrls = {
  r1: 'https://stm.rthk.hk/radio1',
  r2: 'https://stm.rthk.hk/radio2',
  r3: 'https://stm.rthk.hk/radio3',
  r4: 'https://stm.rthk.hk/radio4',
  r5: 'https://stm.rthk.hk/radio5',
  r6: 'http://war.str3am.com:7180/live',
  r7: 'https://tunein.cdnstream1.com/2868_96.mp3',
};

async function startUpstreamStream(keyid) {
  const url = streamUrls[keyid] || streamUrls.r2;
  console.log(`[stream] 建立上游连接: keyid=${keyid} url=${url}`);

  let response;
  try {
    response = await axios({ method: 'get', url, responseType: 'stream' });
  } catch (err) {
    console.error(`[stream] 上游连接失败: keyid=${keyid}`, err.message);
    activeStreams.delete(keyid);
    return;
  }

  const info = activeStreams.get(keyid);
  if (!info) return; // 连接过程中所有客户端已断开
  info.source = response.data;

  response.data.on('data', (chunk) => {
    for (const client of info.clients) {
      try {
        client.write(chunk);
      } catch (e) {
        info.clients.delete(client);
      }
    }
  });

  response.data.on('end', () => {
    console.log(`[stream] 上游流结束: keyid=${keyid}，3秒后重连...`);
    activeStreams.delete(keyid);
    // 如果还有客户端，自动重连
    setTimeout(() => {
      if (info.clients.size > 0) {
        activeStreams.set(keyid, { clients: info.clients, source: null });
        startUpstreamStream(keyid);
      }
    }, 3000);
  });

  response.data.on('error', (err) => {
    console.error(`[stream] 上游流错误: keyid=${keyid}`, err.message);
    activeStreams.delete(keyid);
    setTimeout(() => {
      if (info.clients.size > 0) {
        activeStreams.set(keyid, { clients: info.clients, source: null });
        startUpstreamStream(keyid);
      }
    }, 3000);
  });
}

app.get('/stream', async (req, res) => {
  const keyid = req.query.keyid || 'r1';

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (activeStreams.has(keyid)) {
    // 已有上游连接，直接加入广播
    activeStreams.get(keyid).clients.add(res);
    console.log(`[stream] 客户端加入广播: keyid=${keyid} 当前连接数=${activeStreams.get(keyid).clients.size}`);
  } else {
    // 第一个客户端，建立上游连接
    const clients = new Set([res]);
    activeStreams.set(keyid, { clients, source: null });
    console.log(`[stream] 首个客户端，启动上游连接: keyid=${keyid}`);
    startUpstreamStream(keyid);
  }

  req.on('close', () => {
    const info = activeStreams.get(keyid);
    if (!info) return;
    info.clients.delete(res);
    console.log(`[stream] 客户端断开: keyid=${keyid} 剩余连接数=${info.clients.size}`);
    if (info.clients.size === 0) {
      console.log(`[stream] 无客户端，关闭上游连接: keyid=${keyid}`);
      if (info.source) info.source.destroy();
      activeStreams.delete(keyid);
    }
  });
});


// 转发m3u8文件内容，并替换其中的URL为我们的代理URL
app.get('/m3u8', async (req, res) => {
  try {
    const keyid = req.query.keyid || 'r1';
    var sourceUrl = req.query.url || 'https://1864288729.rsc.cdn77.org/1864288729/tracks-a1/mono.m3u8';
    if (keyid == 'r1') {
      sourceUrl = 'https://tunein.cdnstream1.com/3511_96.aac/playlist.m3u8';//新城财经
    }
    else if (keyid == 'r2') {
      sourceUrl = 'https://rthkradio1-live.akamaized.net/hls/live/2035313/radio1/index_64_a.m3u8';//香港电台第一台
    }
    else if (keyid == 'r3') {
      sourceUrl = 'https://rthkradio5-live.akamaized.net/hls/live/2040081/radio5/master.m3u8';//香港电台第五台
    }
    else if (keyid == 'r4') {
      sourceUrl = 'https://1849807346.rsc.cdn77.org/1849807346/index.m3u8';//新城知识台
    }
    else if (keyid == 'r5') {
      sourceUrl = 'https://sk.cri.cn/am846.m3u8';//CGTN
    }
    else if (keyid == 'r6') {
      sourceUrl = 'https://ngcdn001.cnr.cn/live/zgzs/index.m3u8';//cnr1
    }
    else if (keyid == 'r7') {
      sourceUrl = 'https://1942934317.rsc.cdn77.org/1942934317/index.m3u8';//AM1044
    }
    else {
      sourceUrl = 'https://1864288729.rsc.cdn77.org/1864288729/tracks-a1/mono.m3u8';
    }
    
    const baseUrl = sourceUrl.substring(0, sourceUrl.lastIndexOf('/') + 1);
    
    // 获取m3u8文件内容
    const response = await axios.get(sourceUrl);
    let m3u8Content = response.data;
    
    // 替换所有相对路径为绝对路径，并指向我们的代理
    const lines = m3u8Content.split('\n');
    const newLines = lines.map(line => {
      // 如果是ts文件或其他m3u8文件路径
      if (line && !line.startsWith('#') && (line.endsWith('.ts') || line.endsWith('.m3u8'))) {
        const absoluteUrl = line.startsWith('http') ? line : `${baseUrl}${line}`;
        return `/proxy-audio?url=${encodeURIComponent(absoluteUrl)}`;
      }
      return line;
    });
    
    // 返回修改后的m3u8内容
    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(newLines.join('\n'));
  } catch (error) {
    console.error('获取m3u8内容失败:', error);
    res.status(500).send('获取m3u8内容失败');
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`音频代理服务器运行在 http://localhost:${PORT}`);
});

// 部署说明：
// 1. 将此代码部署到支持Node.js的服务器上（如阿里云、腾讯云等）
// 2. 确保安装所需依赖: npm install express axios cors
// 3. 启动服务: node app.js 或使用PM2: pm2 start app.js
