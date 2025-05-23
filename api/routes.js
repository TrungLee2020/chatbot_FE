const express = require('express');
const router = express.Router();
const axios = require('axios');

// Cấu hình endpoints FastAPI
const FASTAPI = {
    QUERY: 'http://localhost:5000/api/query',
    RAG: 'http://localhost:5000/api/rag'
};

// Cấu hình endpoints FastAPI cho model reasoning (LLaMA) khi cần
const LLAMA_API = 'http://localhost:5001/generate';

// Middleware để xử lý lỗi HTTP
const handleApiError = (error, res) => {
    console.error('API Error:', error);
    if (error.response) {
        // Phản hồi nhận được từ máy chủ với mã trạng thái
        return res.status(error.response.status).json(error.response.data);
    } else if (error.request) {
        // Yêu cầu được gửi đi nhưng không nhận được phản hồi
        return res.status(503).json({ error: 'Không thể kết nối với API. Dịch vụ không khả dụng.' });
    } else {
        // Có lỗi khi thiết lập yêu cầu
        return res.status(500).json({ error: `Lỗi khi gửi yêu cầu: ${error.message}` });
    }
};

// API endpoint để chuyển tiếp truy vấn thống nhất đến FastAPI
router.post('/query', async (req, res) => {
    const { query, top_k, threshold, temperature, max_tokens, reasoning } = req.body;
    
    // Ghi log để debug
    console.log(`Chuyển tiếp truy vấn: ${query}`);
    console.log(`Tham số: top_k=${top_k}, threshold=${threshold}, reasoning=${reasoning}`);
    
    try {
        // Chuyển tiếp yêu cầu đến FastAPI
        const response = await axios.post(FASTAPI.QUERY, {
            query,
            top_k: top_k || 3,
            threshold: threshold || 0.3,
            temperature: temperature || 0.1,
            max_tokens: max_tokens || 8192,
            reasoning: reasoning || false
        });
        
        // Trả về kết quả từ FastAPI
        return res.json(response.data);
    } catch (error) {
        return handleApiError(error, res);
    }
});

// API endpoint để chuyển tiếp truy vấn RAG đến FastAPI
router.post('/rag', async (req, res) => {
    const { query, top_k, threshold } = req.body;
    
    // Ghi log để debug
    console.log(`Chuyển tiếp truy vấn RAG: ${query}`);
    console.log(`Tham số: top_k=${top_k}, threshold=${threshold}`);
    
    try {
        // Chuyển tiếp yêu cầu đến FastAPI
        const response = await axios.post(FASTAPI.RAG, {
            query,
            top_k: top_k || 3,
            threshold: threshold || 0.3
        });
        
        // Trả về kết quả từ FastAPI
        return res.json(response.data);
    } catch (error) {
        return handleApiError(error, res);
    }
});

// API endpoint dự phòng cho trường hợp FastAPI không khả dụng
router.post('/fallback/query', (req, res) => {
    const { query, reasoning } = req.body;
    
    console.log(`Sử dụng fallback cho truy vấn: ${query}`);
    console.log(`Chế độ reasoning: ${reasoning ? 'Bật' : 'Tắt'}`);
    
    // Phản hồi mẫu dựa trên truy vấn và chế độ reasoning
    let answer, thinking;
    
    if (query.toLowerCase().includes('xin chào') || query.toLowerCase().includes('hello')) {
        answer = 'Xin chào! Rất vui được gặp bạn. Mình là Mipo, một trợ lý AI. Mình có thể giúp gì cho bạn?';
        thinking = reasoning ? 'Đây là lời chào, nên mình sẽ đáp lại bằng lời chào thân thiện.' : '';
    } else if (query.toLowerCase().includes('mipo')) {
        answer = 'Mipo là một trợ lý AI được thiết kế để hỗ trợ người dùng với nhiều tác vụ khác nhau. Bạn có thể hỏi mình về bất kỳ điều gì và mình sẽ cố gắng giúp đỡ!';
        thinking = reasoning ? 'Câu hỏi về Mipo, mình sẽ giới thiệu về bản thân.' : '';
    } else if (reasoning) {
        answer = 'Sau khi xem xét câu hỏi của bạn, mình nhận thấy không có đủ thông tin trong ngữ cảnh để trả lời chính xác. Bạn có thể cung cấp thêm thông tin không?';
        thinking = `Phân tích câu hỏi: "${query}"\n\nĐể trả lời câu hỏi này, mình cần kiểm tra ngữ cảnh và dữ liệu có sẵn.\n\nTuy nhiên, trong ngữ cảnh hiện tại không có thông tin đầy đủ về vấn đề này.\n\nVì vậy, mình nên từ chối trả lời và yêu cầu thêm thông tin.`;
    } else {
        answer = `Cảm ơn bạn đã gửi tin nhắn! Đây là một phản hồi mẫu từ backend API cho tin nhắn: "${query}". Trong ứng dụng thực tế, mình sẽ gọi đến một LLM API để tạo câu trả lời phù hợp.`;
        thinking = '';
    }
    
    // Thêm độ trễ nhỏ để mô phỏng độ trễ API
    setTimeout(() => {
        res.json({ 
            answer,
            thinking,
            sources: [],
            metrics: {
                inference_time_seconds: 0.5,
                retrieval_time_seconds: 0.2,
                token_info: {
                    prompt_tokens: 150,
                    completion_tokens: 50,
                    total_tokens: 200
                }
            }
        });
    }, 500);
});

module.exports = router;