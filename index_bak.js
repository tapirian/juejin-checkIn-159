const { chromium } = require("playwright"); // 引入 chromium，你也可以选择 firefox 或 webkit
const fs = require("fs");
const { decodeQR, generateQRtoTerminal } = require("./utils"); // 假设这个文件是通用的
require('dotenv').config();
const axios = require('axios');

const DIR_PATH = "./config";
const COOKIE_PATH = DIR_PATH + "/cookies.json";
const QR_CODE_PATH = DIR_PATH + "/qrcode.png";

let cookies = [];
let msg = `今日签到状态：{checkin}, 获得矿石：{point}`;
let errMsg = "";
let checkin = "";
let point = "-1";

const QYWX_ROBOT = process.env.QYWX_ROBOT;

if (!fs.existsSync(DIR_PATH)) {
    fs.mkdirSync(DIR_PATH);
}

if (!QYWX_ROBOT) {
    console.log("未配置 企业微信群机器人webhook地址, 跳过推送");
}

const pushMsg = async (msg) => {
    if (QYWX_ROBOT) {
        try {
            const response = await axios.post(
                QYWX_ROBOT,
                {
                    msgtype: "text",
                    text: {
                        content: msg,
                        mentioned_list: ['@all']
                    }
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.data.errcode === 0) {
                console.log("推送成功");
            } else {
                console.log("推送失败: ", response.data);
            }
        } catch (error) {
            console.error("请求失败: ", error.message);
        }
    }
};

const getRandomInt = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

// Playwright 推荐使用 page.waitForTimeout() 或更具体的等待条件
const delay = (time) => {
    return new Promise(resolve => setTimeout(resolve, time));
};

const browseRandomArticles = async (page) => { // 移除 browser 参数，直接使用 page
    await page.goto("https://juejin.cn/", {
        waitUntil: "networkidle", // 等同于 Puppeteer 的 networkidle2
    });

    await page.waitForTimeout(3000); // 等待额外的3秒钟，确保文章加载

    // Playwright 推荐使用 locator API
    const articles = page.locator('[data-entry-id]');
    const articlesCount = await articles.count(); // 获取文章数量
    if (articlesCount === 0) {
        console.error("没有找到任何文章，可能页面加载失败或选择器不正确。");
        return;
    }

    const articlesToBrowse = getRandomInt(1, Math.min(7, articlesCount));

    console.log(`准备浏览 ${articlesToBrowse} 篇文章...`);

    for (let i = 0; i < articlesToBrowse; i++) {
        // 使用 nth(i) 来获取单个 locator
        const articleLocator = articles.nth(i);
        
        const articleUrl = await articleLocator.locator('a.jj-link.title').getAttribute('href').catch(() => null);
        const title = await articleLocator.locator("a.jj-link.title").textContent().catch(() => "标题获取失败");
        
        console.log(`标题${i + 1}: ${title}`);
        if (!articleUrl) {
            console.error(`文章 ${i + 1} 没有找到URL，跳过`);
            continue;
        }

        console.log(`文章 ${i + 1} URL: ${articleUrl}`);

        let newPage = null;
        try {
            // Playwright 可以直接在当前 context 创建新页面
            newPage = await page.context().newPage(); // 在当前浏览器上下文创建新页面
            
            await newPage.goto(articleUrl, { waitUntil: 'domcontentloaded' });
            
            await newPage.waitForLoadState('domcontentloaded', { timeout: 60000 }); // 确保页面加载
            // 或者更精确地等待某个元素：await newPage.locator('body').waitFor();

            await newPage.waitForTimeout(getRandomInt(2000, 5000)); // 随机浏览时间2-5秒

            console.log(`已浏览文章 ${i + 1} - 标题: ${title}`);
        } catch (error) {
            console.error(`浏览文章 ${i + 1} 时发生错误: ${error.message}`);
        } finally {
            if (newPage) {
                try {
                    await newPage.close();
                    console.log(`新页面已关闭`);
                } catch (closeError) {
                    console.error(`关闭新页面时发生错误: ${closeError.message}`);
                }
            }
        }
    }
};

const main = async () => {
    console.log("开始签到");
    let browser; // 声明 browser 变量
    try {
        browser = await chromium.launch({ // 使用 chromium.launch
            // Playwright 默认会下载和使用自己的浏览器二进制文件
            // 一般情况下不需要指定 executablePath，除非你想用系统已安装的 Chrome
            // args 选项也类似，"--no-sandbox" 在某些Linux环境下可能需要，Playwright会处理好
            // headless 默认为 true，如果你想看到浏览器界面，可以设置为 false
            headless: true, // 或者 false
        });

        // 使用 browser context 来管理 cookies 和独立的会话
        const context = await browser.newContext({
            // 设置 User-Agent 和 Viewport 在 context 级别
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
            viewport: {
                width: 1920,
                height: 1080,
            },
            // 其他 context 选项，如权限等
        });
        context.setDefaultTimeout(1000 * 60 * 5); // 设置 context 级别的默认超时时间

        const page = await context.newPage();

        await page.goto("https://juejin.cn/", {
            waitUntil: "networkidle", // 等同于 Puppeteer 的 networkidle0
        });

        const login = async (retryCount = 0) => {
            if (retryCount > 3) {
                throw new Error("二维码获取失败，重试次数过多");
            }

            const loginButton = page.locator(".login-button"); // 使用 locator
            await loginButton.click();

            // 等待二维码图片的容器出现
            await page.waitForSelector(".qrcode-img", { timeout: 5000 }).catch(async () => {
                console.log("二维码图片未找到，正在刷新页面...");
                await page.reload({ waitUntil: "networkidle" });
                await login(retryCount + 1); // 递归调用login，增加重试次数
            });

            await page.waitForTimeout(1000); // 延迟1秒

            const qrCodeImgLocator = page.locator(".qrcode-img");
            if (!await qrCodeImgLocator.isVisible()) { // 检查元素是否可见
                throw new Error("未找到二维码图片");
            }

            // 获取 boundingBox
            const boundingBox = await qrCodeImgLocator.boundingBox();
            if (!boundingBox || boundingBox.width === 0 || boundingBox.height === 0) {
                console.log("二维码图片尚未加载完成或尺寸不正确，正在重试...");
                await page.reload({ waitUntil: "networkidle" });
                await login(retryCount + 1); // 递归调用login，增加重试次数
                return;
            }

            await qrCodeImgLocator.screenshot({
                path: QR_CODE_PATH,
            });

            console.log(`请扫描 ${QR_CODE_PATH} 中的二维码进行登录`);

            const url = await decodeQR(QR_CODE_PATH);
            console.log(generateQRtoTerminal(url));

            // Playwright 获取 cookies 的方式，通常在页面导航后
            // page.on("framenavigated", ...) 可以替换为 await page.waitForURL 或 await page.waitForLoadState
            // 登录成功后，页面会跳转到主页，此时可以获取 cookies
            await page.waitForURL("https://juejin.cn/", { waitUntil: "networkidle" }); // 等待跳转到主页

            const currentCookies = await context.cookies(); // 从 context 获取 cookies
            fs.writeFileSync(COOKIE_PATH, JSON.stringify(currentCookies, null, 2));
            console.log("Cookies 已保存。");
        };

        if (!fs.existsSync(COOKIE_PATH)) {
            await login();
        } else {
            cookies = JSON.parse(fs.readFileSync(COOKIE_PATH, "utf-8"));
            await context.addCookies(cookies); // 使用 context.addCookies
            console.log("Cookies 已加载。");
        }

        let maxRetries = 3;
        let attempt = 0;
        let freeDrawFound = false;
        let alreadySignedIn = false; //判断是否已签到

        while (attempt < maxRetries && !freeDrawFound && !alreadySignedIn) {
            attempt += 1;

            await page.goto("https://juejin.cn/user/center/signin?from=main_page", {
                waitUntil: "networkidle",
            });

            await page.waitForTimeout(7000); // Playwright 推荐使用 page.waitForTimeout()

            try {
                const signedinButton = page.locator(".code-calender .signedin");
                if (await signedinButton.isVisible()) { // 检查元素是否可见
                    console.log("已签到，无需重复签到");
                    alreadySignedIn = true;
                } else {
                    await page.waitForSelector(".code-calender .signin", { visible: true, timeout: 5000 });
                    const checkinButton = page.locator(".code-calender .signin"); // 使用 locator

                    if (await checkinButton.isVisible()) { // 再次检查是否可见
                        await checkinButton.click();
                        console.log("签到按钮已点击。");
                    } else {
                        console.log("签到按钮未找到，可能页面未正确加载");
                    }
                }

                await page.waitForSelector(".header-text > .figure-text");
                const figureText = page.locator(".header-text > .figure-text");
                point = await figureText.textContent() || point; // 直接获取文本内容
            } catch (e) {
                console.log("发生错误，无法完成签到或获取积分信息", e.message);
            }

            // Playwright 的 page.on('response') 依然可以使用
            page.on("response", async (response) => {
                const url = response.url();
                if (
                    url.includes("get_today_status") &&
                    response.request().method() === "GET"
                ) {
                    try {
                        const data = await response.json();
                        console.log(`签到状态API响应: ${JSON.stringify(data)}`);
                        if (data && data.data && data.data.check_in_done) {
                             checkin = data.data.check_in_done ? "已签到" : "未签到";
                             console.log(`签到状态: ${checkin}`);
                        } else {
                            console.log("签到状态API响应中 check_in_done 不存在或为 false");
                        }
                    } catch (e) {
                        console.error("解析签到状态API响应失败:", e.message);
                    }
                }
            });

            await page.waitForTimeout(2000);
            await page.goto("https://juejin.cn/user/center/lottery?from=sign_in_success", {
                waitUntil: "networkidle",
            });

            await page.waitForTimeout(2000);
            //新增是否已经免费抽奖判断
            try {
                const freeTextDiv = page.locator("#turntable-item-0 div.text-free");
                // 使用 locator.click() 并在内部处理等待可见性
                if (await freeTextDiv.isVisible({ timeout: 5000 })) { 
                    await freeTextDiv.click();
                    console.log("已点击抽奖按钮");
                    freeDrawFound = true;
                } else {
                    console.log("未找到可点击的免费抽奖按钮");
                }
            } catch (e) {
                console.log("未找到可点击的免费抽奖按钮或点击失败:", e.message);
            }

            if (!freeDrawFound && !alreadySignedIn) {
                console.log(`未找到免费抽奖按钮或未签到，第${attempt}次重试签到`);
            }
        }

        if (attempt >= maxRetries && !freeDrawFound) {
            console.log("已达到最大重试次数，签到失败");
        } else {
            // 浏览随机数量的文章
            await page.waitForTimeout(2000);
            await browseRandomArticles(page); // 传递 page
        }

        await page.reload({
            waitUntil: "networkidle",
        });

        // 由于 page.on('response') 是异步的，签到状态可能不会立即更新
        // 为了确保获取到最新的签到状态，可能需要再次检查或等待
        // 简单处理：如果之前没有获取到，尝试用默认值或再次检查页面元素
        if (!checkin) {
            // 尝试从页面元素再次获取签到状态，如果需要
            // 例如：检查签到按钮是否仍存在或状态文本
            const signedinButton = page.locator(".code-calender .signedin");
            checkin = await signedinButton.isVisible() ? "已签到" : "未签到";
        }

        if (!point || point === "-1") {
            // 尝试从页面元素再次获取积分，如果需要
            const figureText = page.locator(".header-text > .figure-text");
            point = await figureText.textContent() || "-1";
        }


        msg = msg.replace("{checkin}", checkin).replace("{point}", point);
        console.log(msg);
        await pushMsg(msg);

    } catch (e) {
        const error = e;
        console.error(error);
        errMsg = error.message;
        await pushMsg(`签到失败: ${errMsg}`);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
            console.log("浏览器已关闭。");
        }
    }
    console.log("本轮签到结束");
};

main();