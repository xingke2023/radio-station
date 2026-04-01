// 测试 API 返回的字段名
const http = require('http');

const options = {
    hostname: 'localhost',
    port: 8533,
    path: '/api/radios',
    method: 'GET'
};

const req = http.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            if (json.success && json.radios && json.radios.length > 0) {
                const sample = json.radios[0];
                console.log('✅ API 返回字段:');
                console.log('   - 电台ID字段:', Object.keys(sample).includes('id') ? '✅ id' : '❌ 缺少 id');
                console.log('   - 名称字段:', Object.keys(sample).includes('name') ? '✅ name' : '❌ 缺少 name');
                console.log('   - URL字段:', Object.keys(sample).includes('url') ? '✅ url' : '❌ 缺少 url');
                console.log('\n示例电台:');
                console.log(JSON.stringify(sample, null, 2));
            } else {
                console.log('❌ API 返回格式错误:', json);
            }
        } catch (error) {
            console.error('❌ 解析失败:', error.message);
        }
    });
});

req.on('error', (error) => {
    console.error('❌ 请求失败:', error.message);
});

req.end();
