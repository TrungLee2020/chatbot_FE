// Lấy các phần tử DOM cần thiết và lưu vào biến để giảm truy cập DOM
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const reasoningBtn = document.getElementById('reasoningBtn');
const modelBtn = document.getElementById('modelBtn');
const selectedModel = document.getElementById('selectedModel');
const modelDropdown = document.getElementById('modelDropdown');
const chatContainer = document.querySelector('.chat-container');

// Cấu hình API endpoints
const API_CONFIG = {
    FASTAPI: {
        QUERY: 'http://localhost:5001/api/query',
        RAG: 'http://localhost:5001/api/rag'
    },
    NODE_API: {
        QUERY: '/api/query',
        RAG: '/api/rag'
    }
};

// Sử dụng API Node.js mặc định
let CURRENT_API = API_CONFIG.NODE_API;

// Biến để lưu trữ kết quả RAG gần đây nhất
let lastRagResults = [];

// Đối tượng để ánh xạ model hiển thị sang model API
const MODEL_MAPPING = {
    'Mipo v1': 'default',
    'Mipo v2': 'mipo',
    'Mipo Pro': 'mipo'
};

// Danh sách lưu lịch sử hội thoại
let conversationHistory = [];

// Mảng các câu chào mà client có thể xử lý trực tiếp
const GREETINGS = [
    { pattern: /^xin\s*chào/i, response: 'Xin chào! Mình là Mipo, rất vui được gặp bạn. Mình có thể giúp gì cho bạn hôm nay?' },
    { pattern: /^chào/i, response: 'Chào bạn! Mình là Mipo, trợ lý AI. Mình có thể giúp gì cho bạn?' },
    { pattern: /^hi|^hello|^helo/i, response: 'Hi! Mình là Mipo. Rất vui được gặp bạn. Mình có thể hỗ trợ bạn như thế nào?' },
    { pattern: /^hola|^halo/i, response: 'Hola! Mình là Mipo. Rất vui được gặp bạn. Mình có thể giúp gì cho bạn không?' },
    { pattern: /^mipo|^s*chào mipo/i, response: 'Vâng, mình là Mipo! Mình là trợ lý AI được thiết kế để hỗ trợ bạn với nhiều loại thông tin và câu hỏi khác nhau. Bạn cần giúp gì không?' }
];

// Tối ưu hiệu ứng gõ chữ bằng requestAnimationFrame
let typingRafId = null;
async function typeMessage(element, text) {
    let index = 0;
    element.textContent = '';

    return new Promise((resolve) => {
        const type = () => {
            if (index < text.length) {
                element.textContent += text[index++];
                chatContainer.scrollTop = chatContainer.scrollHeight;
                typingRafId = requestAnimationFrame(type);
            } else {
                resolve();
            }
        };
        typingRafId = requestAnimationFrame(type);
    });
}

// Hàm tạo tin nhắn với avatar
function createMessage(role) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message-${role} flex items-start space-x-3 w-full max-w-xl fade-in`;
    if (role === 'user') {
        messageDiv.classList.add('flex-row-reverse', 'space-x-reverse');
    }
    messageDiv.innerHTML = `
        <div class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 avatar">
            <i class="fas fa-${role === 'user' ? 'user' : 'robot'} text-sm"></i>
        </div>
        <div class="content w-full">
            <div class="response-content text-gray-700 text-base"></div>
        </div>
    `;
    return { messageDiv, contentElement: messageDiv.querySelector('.response-content') };
}

// Hàm tạo phần hiển thị nguồn tham khảo (sources)
function createSourcesElement(sources) {
    if (!sources || sources.length === 0) return '';

    const sourcesDiv = document.createElement('div');
    sourcesDiv.className = 'sources-container mt-2 text-xs text-gray-500';

    const sourcesToggle = document.createElement('button');
    sourcesToggle.className = 'text-gray-500 hover:text-gray-700 flex items-center';
    sourcesToggle.innerHTML = `
        <i class="fas fa-info-circle mr-1"></i>
        <span>Nguồn tham khảo (${sources.length})</span>
        <i class="fas fa-chevron-down ml-1 text-xs transition-transform"></i>
    `;

    const sourcesList = document.createElement('div');
    sourcesList.className = 'sources-list mt-2 hidden';

    sources.forEach((source, index) => {
        const sourceItem = document.createElement('div');
        sourceItem.className = 'source-item text-xs bg-gray-50 p-2 rounded mb-1';

        const content = source.content || source.document;
        const shortContent = content ? 
            (content.length > 100 ? content.substring(0, 100) + '...' : content) : 
            'Không có nội dung';

        sourceItem.innerHTML = `
            <div class="font-medium text-gray-700">Nguồn ${index + 1}</div>
            <div class="text-gray-600 mt-1">${shortContent}</div>
        `;
        sourcesList.appendChild(sourceItem);
    });

    sourcesDiv.appendChild(sourcesToggle);
    sourcesDiv.appendChild(sourcesList);

    sourcesToggle.addEventListener('click', () => {
        sourcesList.classList.toggle('hidden');
        const icon = sourcesToggle.querySelector('.fa-chevron-down');
        icon.classList.toggle('rotate-180');
    });

    return sourcesDiv;
}

// Hàm phân tách reasoning thành các bước
function splitThinkingIntoSteps(thinking) {
    if (!thinking || !thinking.trim()) return [];

    const lines = thinking.split('\n').filter(line => line.trim().length > 0);
    const steps = [];
    let currentStep = '';
    let stepCounter = 0;
    const stepRegex = /Bước \d+:/g;
    let isStepSection = false;

    const irrelevantPrefixes = [
        'Phương pháp này',
        'Như vậy',
        'Nếu bạn cần',
        'Câu hỏi bổ sung',
        'Trả lời',
        'Đương nhiên',
        '---',
        'Trong ngữ cảnh',
        'Dưới đây là một ví dụ'
    ];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.match(stepRegex)) {
            if (currentStep) steps.push(currentStep.trim());
            currentStep = line;
            isStepSection = true;
        } else if (irrelevantPrefixes.some(prefix => line.startsWith(prefix))) {
            isStepSection = false;
            continue;
        } else if (isStepSection) {
            currentStep += '\n' + line;
        } else if (!isStepSection) {
            if (line.length > 30 && !line.match(/^(#|##|---)/)) {
                const stepKeywords = ['Thu thập', 'Phân tích', 'Sử dụng', 'So sánh', 'Đánh giá', 'Xác định'];
                if (stepKeywords.some(keyword => line.includes(keyword))) {
                    stepCounter++;
                    currentStep = `Bước ${stepCounter}: ${line}`;
                    steps.push(currentStep);
                    currentStep = '';
                    isStepSection = true;
                }
            }
        }
    }

    if (currentStep && isStepSection) {
        steps.push(currentStep.trim());
    }

    if (steps.length === 0) {
        const potentialSteps = thinking.split(/[.\n]+/)
            .filter(s => {
                const trimmed = s.trim();
                return trimmed.length > 30 &&
                       !irrelevantPrefixes.some(prefix => trimmed.startsWith(prefix)) &&
                       !trimmed.match(/^(#|##|---)/);
            })
            .map((s, i) => `Bước ${i + 1}: ${s.trim()}`);

        return potentialSteps.filter(step => {
            const stepKeywords = ['Thu thập', 'Phân tích', 'Sử dụng', 'So sánh', 'Đánh giá', 'Xác định'];
            return stepKeywords.some(keyword => step.includes(keyword));
        });
    }

    return steps;
}

// Hàm tạo phần hiển thị reasoning với hiệu ứng typing
async function createThinkingSteps(thinking, parentElement) {
    const steps = splitThinkingIntoSteps(thinking);
    if (steps.length === 0) return;

    for (let i = 0; i < steps.length; i++) {
        const stepDiv = document.createElement('div');
        stepDiv.className = 'thinking-step mb-3 opacity-0 border-l-2 border-blue-200 pl-3';
        parentElement.appendChild(stepDiv);

        const stepTitle = document.createElement('h4');
        stepTitle.className = 'step-title text-blue-600 font-semibold text-sm mb-1';
        const titleMatch = steps[i].match(/Bước \d+:/);
        stepTitle.textContent = titleMatch ? titleMatch[0] : `Bước ${i + 1}:`;
        stepDiv.appendChild(stepTitle);

        const stepText = document.createElement('div');
        stepText.className = 'step-content text-gray-700 text-xs';
        stepDiv.appendChild(stepText);

        stepDiv.style.opacity = '0';
        await new Promise(resolve => setTimeout(resolve, 200));
        stepDiv.style.transition = 'opacity 0.5s ease-in';
        stepDiv.style.opacity = '1';

        const content = steps[i].replace(/Bước \d+:/, '').trim();
        const contentLines = content.split('\n').filter(line => line.trim().length > 0);
        for (let line of contentLines) {
            const lineP = document.createElement('p');
            lineP.className = 'mb-1';
            stepText.appendChild(lineP);
            await typeMessage(lineP, line.trim());
        }
    }
}

// Hàm tạo nút toggle cho phần thinking
function createThinkingToggle(thinking) {
    if (!thinking || !thinking.trim()) return null;

    const thinkingDiv = document.createElement('div');
    thinkingDiv.className = 'thinking-toggle-container mb-2 text-xs text-gray-500';

    const thinkingToggle = document.createElement('button');
    thinkingToggle.className = 'text-gray-500 hover:text-gray-700 flex items-center';
    thinkingToggle.innerHTML = `
        <i class="fas fa-lightbulb mr-1"></i>
        <span>Suy luận</span>
        <i class="fas fa-chevron-down ml-1 text-xs transition-transform"></i>
    `;

    const thinkingList = document.createElement('div');
    thinkingList.className = 'thinking-list mt-2 hidden opacity-0 transition-opacity duration-300';

    thinkingDiv.appendChild(thinkingToggle);
    thinkingDiv.appendChild(thinkingList);

    thinkingToggle.addEventListener('click', async () => {
        if (!thinkingList.innerHTML) {
            await createThinkingSteps(thinking, thinkingList);
        }

        thinkingList.classList.toggle('hidden');
        const icon = thinkingToggle.querySelector('.fa-chevron-down');
        icon.classList.toggle('rotate-180');

        if (!thinkingList.classList.contains('hidden')) {
            thinkingList.style.opacity = '1';
        } else {
            thinkingList.style.opacity = '0';
        }
    });

    return thinkingDiv;
}

// Hàm thêm tin nhắn của người dùng vào giao diện và lịch sử
async function addUserMessage(message) {
    const { messageDiv, contentElement } = createMessage('user');
    chatContainer.appendChild(messageDiv);

    await typeMessage(contentElement, message);

    chatContainer.scrollTop = chatContainer.scrollHeight;
    conversationHistory.push({ role: 'user', content: message });
}

// Hàm hiển thị hiệu ứng đang nhập tin nhắn (thinking animation)
function showThinkingAnimation() {
    const thinkingIndicator = document.createElement('div');
    thinkingIndicator.className = 'message-ai flex items-start space-x-3 w-full max-w-xl fade-in';
    thinkingIndicator.id = 'thinking-indicator';
    thinkingIndicator.innerHTML = `
        <div class="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 flex-shrink-0">
            <i class="fas fa-robot text-sm"></i>
        </div>
        <div class="content w-full">
            <div class="thinking-animation flex space-x-1">
                <span class="thinking-dot"></span>
                <span class="thinking-dot"></span>
                <span class="thinking-dot"></span>
            </div>
        </div>
    `;
    chatContainer.appendChild(thinkingIndicator);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return thinkingIndicator;
}

// Hàm xóa hiệu ứng đang nhập
function removeThinkingAnimation(thinkingIndicator) {
    if (thinkingIndicator && thinkingIndicator.parentNode) {
        chatContainer.removeChild(thinkingIndicator);
    }
}

// Hàm kiểm tra xem tin nhắn có phải là lời chào không
function isGreeting(message) {
    return GREETINGS.find(greeting => greeting.pattern.test(message));
}

// Hàm xử lý lời chào đơn giản trên client
function handleGreeting(message) {
    const greeting = isGreeting(message);
    return greeting ? greeting.response : null;
}

// Hàm tách dữ liệu (bỏ hoàn toàn logic xử lý thẻ <think>)
function splitResponseData(data) {
    let message = data;
    let thinking = '';

    if (typeof data === 'string') {
        message = data.trim();
    } else if (data && typeof data === 'object') {
        thinking = data.thinking || '';
        message = data.answer || 'Mình đã nhận được câu hỏi của bạn, nhưng không có phản hồi từ API.';
    }

    return { message, thinking };
}

// Hàm định dạng câu trả lời chính
async function formatResponseMessage(contentElement, message) {
    const sections = message.split('---').filter(section => section.trim().length > 0);
    let mainContent = '';
    const additionalSections = [];

    sections.forEach(section => {
        section = section.trim();
        if (section.startsWith('**')) {
            additionalSections.push(section);
        } else {
            mainContent = section;
        }
    });

    const mainDiv = document.createElement('div');
    mainDiv.className = 'response-main mb-4 opacity-0';
    mainDiv.style.transition = 'opacity 0.5s ease-in';
    contentElement.appendChild(mainDiv);

    await new Promise(resolve => setTimeout(resolve, 100));
    mainDiv.style.opacity = '1';

    const mainLines = mainContent.split('\n').filter(line => line.trim().length > 0);
    for (let line of mainLines) {
        const p = document.createElement('p');
        p.className = 'mb-1';
        if (line.startsWith('-')) {
            p.className += ' pl-4';
            p.textContent = '';
        } else {
            p.textContent = '';
        }
        mainDiv.appendChild(p);
        await typeMessage(p, line.startsWith('-') ? `• ${line.replace(/^-\s*/, '')}` : line);
    }

    for (const section of additionalSections) {
        const sectionDiv = document.createElement('div');
        sectionDiv.className = 'response-section mt-3 opacity-0';
        sectionDiv.style.transition = 'opacity 0.5s ease-in';

        const lines = section.split('\n').filter(line => line.trim().length > 0);
        const title = lines[0].replace(/\*\*/g, '').trim();
        const titleElement = document.createElement('h4');
        titleElement.className = 'section-title text-blue-600 font-semibold text-sm mb-2';
        titleElement.textContent = title;
        sectionDiv.appendChild(titleElement);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'section-content text-gray-700 text-base';
        sectionDiv.appendChild(contentDiv);

        for (const line of lines.slice(1)) {
            const p = document.createElement('p');
            p.className = 'mb-1';
            if (line.startsWith('-')) {
                p.className += ' pl-4';
                p.textContent = '';
            } else {
                p.textContent = '';
            }
            contentDiv.appendChild(p);
            await typeMessage(p, line.startsWith('-') ? `• ${line.replace(/^-\s*/, '')}` : line);
        }

        contentElement.appendChild(sectionDiv);

        await new Promise(resolve => setTimeout(resolve, 200));
        sectionDiv.style.opacity = '1';
    }
}

// Hàm thêm tin nhắn của bot với hiệu ứng gõ chữ và nguồn tham khảo
async function addAIMessage(message, sources = [], thinking = '') {
    const { messageDiv, contentElement } = createMessage('ai');
    chatContainer.appendChild(messageDiv);

    const thinkingToggle = createThinkingToggle(thinking);
    if (thinkingToggle) {
        contentElement.appendChild(thinkingToggle);
    }

    await formatResponseMessage(contentElement, message);

    if (sources && sources.length > 0) {
        const sourcesElement = createSourcesElement(sources);
        if (sourcesElement) {
            contentElement.appendChild(sourcesElement);
        }
    }

    chatContainer.scrollTop = chatContainer.scrollHeight;
    conversationHistory.push({ role: 'bot', content: message });
}

// Hàm gửi truy vấn đến API thống nhất
async function queryUnifiedApi(query, topK = 3, threshold = 0.3, temperature = 0.1) {
    const isReasoning = reasoningBtn.classList.contains('reasoning-active');
    const selectedModelText = selectedModel.textContent;
    const modelKey = MODEL_MAPPING[selectedModelText] || 'default';

    try {
        console.log(`Đang gửi truy vấn với reasoning=${isReasoning}`);

        const response = await fetch(CURRENT_API.QUERY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query,
                top_k: topK,
                threshold,
                temperature: temperature,
                max_tokens: 8192,
                reasoning: isReasoning
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Lỗi khi gửi truy vấn đến API');
        }

        return await response.json();
    } catch (error) {
        console.error('Lỗi khi gửi truy vấn:', error);
        throw error;
    }
}

// Hàm gửi tin nhắn và nhận phản hồi từ API thống nhất
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;

    await addUserMessage(message);
    messageInput.value = '';
    messageInput.style.height = '60px';

    const thinkingIndicator = showThinkingAnimation();

    try {
        const greetingResponse = handleGreeting(message);
        if (greetingResponse) {
            console.log('Xử lý lời chào trực tiếp trên client');
            await new Promise(resolve => setTimeout(resolve, 1500));
            removeThinkingAnimation(thinkingIndicator);
            await addAIMessage(greetingResponse);
            return;
        }

        const apiResponse = await queryUnifiedApi(message);
        await new Promise(resolve => setTimeout(resolve, 1500)); // Đảm bảo animation hiển thị ít nhất 1.5 giây
        removeThinkingAnimation(thinkingIndicator);

        const { message: responseMessage, thinking } = splitResponseData(apiResponse);

        await addAIMessage(
            responseMessage || 'Mình đã nhận được câu hỏi của bạn, nhưng không có phản hồi từ API.',
            apiResponse.sources || [],
            thinking || ''
        );
    } catch (error) {
        removeThinkingAnimation(thinkingIndicator);
        await addAIMessage('Có lỗi xảy ra khi kết nối với API. Vui lòng thử lại.');
        console.error('Lỗi API:', error);
    }
}

// Thêm hàm để chuyển đổi giữa API FastAPI và Node.js
function toggleApiEndpoint(useFastApi = false) {
    CURRENT_API = useFastApi ? API_CONFIG.FASTAPI : API_CONFIG.NODE_API;
    console.log(`Đã chuyển sang sử dụng ${useFastApi ? 'FastAPI' : 'Node.js'} API`);
}

// Tối ưu sự kiện với debounce cho resize textarea
let resizeTimeout;
messageInput.addEventListener('input', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        messageInput.style.height = 'auto';
        messageInput.style.height = messageInput.scrollHeight + 'px';
    }, 50);
});

// Xử lý sự kiện nhấn nút gửi
sendBtn.addEventListener('click', sendMessage);

// Xử lý sự kiện nhấn Enter để gửi tin nhắn
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Xử lý bật/tắt chế độ reasoning
reasoningBtn.addEventListener('click', () => {
    reasoningBtn.classList.toggle('reasoning-active');

    const isActive = reasoningBtn.classList.contains('reasoning-active');
    const bulbIcon = reasoningBtn.querySelector('.fa-lightbulb');
    if (isActive) {
        reasoningBtn.setAttribute('title', 'Chế độ suy luận: BẬT');
        reasoningBtn.classList.add('text-blue-600', 'bg-blue-100');
        bulbIcon.classList.add('text-yellow-500');
    } else {
        reasoningBtn.setAttribute('title', 'Chế độ suy luận: TẮT');
        reasoningBtn.classList.remove('text-blue-600', 'bg-blue-100');
        bulbIcon.classList.remove('text-yellow-500');
    }

    console.log(`Chế độ reasoning: ${isActive ? 'BẬT' : 'TẮT'}`);
});

// Xử lý chọn model từ dropdown
modelDropdown.addEventListener('click', (e) => {
    e.preventDefault();
    const model = e.target.getAttribute('data-model');
    if (model) {
        selectedModel.textContent = model;
        modelDropdown.classList.add('hidden');
    }
});

// Xử lý hiển thị/ẩn dropdown chọn model
modelBtn.addEventListener('click', () => modelDropdown.classList.toggle('hidden'));

// Ẩn dropdown khi click bên ngoài
document.addEventListener('click', (e) => {
    if (!modelBtn.contains(e.target) && !modelDropdown.contains(e.target)) {
        modelDropdown.classList.add('hidden');
    }
});

// Thêm chào mừng khi tải trang
window.addEventListener('DOMContentLoaded', async () => {
    await new Promise(resolve => setTimeout(resolve, 1000));
    await addAIMessage('Xin chào! Mình là Mipo, trợ lý AI. Mình có thể giúp gì cho bạn hôm nay?');
});

// Mặc định sử dụng FastAPI trực tiếp
toggleApiEndpoint(true);

// Tập trung vào ô nhập tin nhắn khi tải trang
messageInput.focus();