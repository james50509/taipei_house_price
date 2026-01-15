import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Building2, MapPin, BarChart3, Home, RefreshCw, AlertTriangle, 
  Database, Upload, FileText, Info, Search, Clock, Clipboard,
  TrendingUp, DollarSign, Sparkles, X, Loader2, RefreshCcw,
  List, HelpCircle, Send, Download, PieChart, ArrowLeft, Image as ImageIcon
} from 'lucide-react';
import { Transaction, GroupedData, DataStats, ProcessedData, ChatMessage, RoomStat } from './types';
import { generateMarketAnalysis, generateChatResponse } from './services/geminiService';

// Declare html2canvas on window
declare global {
  interface Window {
    html2canvas: any;
  }
}

const App = () => {
  const [activeTab, setActiveTab] = useState<'table' | 'cards' | 'analysis' | 'market' | 'recent'>('table');
  const [dataSource, setDataSource] = useState<'api' | 'upload'>('api'); 
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // View Mode: 'dashboard' or 'report'
  const [viewMode, setViewMode] = useState<'dashboard' | 'report'>('dashboard');
  
  // Data States
  const [displayData, setDisplayData] = useState<GroupedData[]>([]); // Grouped Data
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]); // Flat Data (All transactions)
  
  const [searchTerm, setSearchTerm] = useState("");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [autoUpdate, setAutoUpdate] = useState(true); 
  const [csvText, setCsvText] = useState("");
  
  // AI State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isChatting, setIsChatting] = useState(false);   
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [showAnalysisPanel, setShowAnalysisPanel] = useState(false);
  const [aiTab, setAiTab] = useState<'report' | 'chat'>('report'); 
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
      { role: 'model', text: '嗨！我是您的房市數據助手。關於目前的建案資料，想了解什麼細節嗎？\n(例如：哪一區最貴？、成交量最大的建案是？)' }
  ]);
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const reportContainerRef = useRef<HTMLDivElement>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  // Chart & Section Refs
  const chartRef = useRef<SVGSVGElement>(null);
  const marketOverviewRef = useRef<HTMLDivElement>(null);
  
  const [dataStats, setDataStats] = useState<DataStats>({ totalRaw: 0, presale: 0, filtered: 0 });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const topScrollContainerRef = useRef<HTMLDivElement>(null);

  // Government Open Data Resource ID
  const [resourceId] = useState('2979c431-7a32-4067-9af2-e716cd825c4b'); 

  // Scroll Sync
  const handleScroll = (source: 'top' | 'table') => {
    if (source === 'top' && topScrollContainerRef.current && tableContainerRef.current) {
        tableContainerRef.current.scrollLeft = topScrollContainerRef.current.scrollLeft;
    } else if (source === 'table' && topScrollContainerRef.current && tableContainerRef.current) {
        topScrollContainerRef.current.scrollLeft = tableContainerRef.current.scrollLeft;
    }
  };

  const decodeContent = (buffer: ArrayBuffer): string => {
      const decoderUTF8 = new TextDecoder('utf-8');
      const textUTF8 = decoderUTF8.decode(buffer);
      
      if (textUTF8.includes('預售屋') || textUTF8.includes('建案') || textUTF8.includes('臺北市') || textUTF8.includes('行政區')) {
          return textUTF8;
      }
      
      try {
          const decoderBig5 = new TextDecoder('big5');
          const textBig5 = decoderBig5.decode(buffer);
          return textBig5;
      } catch (e) {
          console.warn("Big5 decode failed, falling back to UTF-8", e);
          return textUTF8;
      }
  };

  const parseCSV = (text: string): Record<string, string>[] => {
    const cleanText = text.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '');
    const lines = cleanText.split(/\r\n|\n/);
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').replace(/[\u200B-\u200D\uFEFF]/g, ''));
    
    const result: Record<string, string>[] = [];
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const rowData: string[] = [];
        let currentVal = '';
        let insideQuote = false;
        
        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '"') {
                insideQuote = !insideQuote;
            } else if (char === ',' && !insideQuote) {
                rowData.push(currentVal);
                currentVal = '';
            } else {
                currentVal += char;
            }
        }
        rowData.push(currentVal); 

        const obj: Record<string, string> = {};
        headers.forEach((header, index) => {
            let val = rowData[index]?.trim() || '';
            if (val.startsWith('"') && val.endsWith('"')) {
                val = val.slice(1, -1).replace(/""/g, '"');
            }
            obj[header] = val;
        });
        result.push(obj);
    }
    return result;
  };

  const findKey = (obj: any, targetKey: string) => {
      if (!obj) return null;
      return Object.keys(obj).find(k => k && k.toUpperCase().trim() === targetKey.toUpperCase());
  };

  const parseROCDate = (rocDateStr: string): Date | null => {
      if (!rocDateStr || rocDateStr.length < 6) return null;
      const yearLen = rocDateStr.length === 7 ? 3 : 2;
      const year = parseInt(rocDateStr.substring(0, yearLen)) + 1911;
      const month = parseInt(rocDateStr.substring(yearLen, yearLen + 2)) - 1; 
      const day = parseInt(rocDateStr.substring(yearLen + 2));
      const d = new Date(year, month, day);
      return isNaN(d.getTime()) ? null : d;
  };

  const processRawData = (rawData: any[]): ProcessedData => {
    const grouped: Record<string, any> = {};
    const allTransactions: Transaction[] = []; 
    let presaleCount = 0;
    let filteredCount = 0;

    rawData.forEach(row => {
      const nameKey = findKey(row, '建案名稱') || findKey(row, 'BUILD_NAME') || findKey(row, 'case_name');
      const districtKey = findKey(row, '行政區') || findKey(row, 'DISTRICT') || findKey(row, 'district');
      const addressKey = findKey(row, '土地區段位置建物區段門牌') || findKey(row, 'LOCATION') || findKey(row, 'address');
      const caseTypeKey = findKey(row, 'CASE_T') || findKey(row, 'case_t');
      const caseObjectKey = findKey(row, '交易標的') || findKey(row, 'CASE_F');

      let name = nameKey ? row[nameKey] : null;
      const district = districtKey ? row[districtKey] : null;
      const address = addressKey ? row[addressKey] : null;
      let caseType = caseTypeKey ? row[caseTypeKey] : null;
      let caseObject = caseObjectKey ? row[caseObjectKey] : "";

      if (caseType) caseType = caseType.trim();

      if (caseType && !caseType.includes('預售')) { 
          filteredCount++; 
          return; 
      }
      
      if (!name) { filteredCount++; return; }

      presaleCount++;

      const priceKey = findKey(row, '單價元坪') || findKey(row, 'UPRICE');
      const totalKey = findKey(row, '總價元') || findKey(row, 'TPRICE');
      const areaKey = findKey(row, '建物移轉總面積坪') || findKey(row, 'FAREA');
      const floorKey = findKey(row, '交易樓層') || findKey(row, 'TBUILD');
      const dateKey = findKey(row, '交易年月日') || findKey(row, 'SDATE');
      const noteKey = findKey(row, '備註') || findKey(row, 'RMNOTE');
      const parkPriceKey = findKey(row, '車位總價元') || findKey(row, 'PPRICE');
      const parkAreaKey = findKey(row, '車位移轉總面積坪') || findKey(row, 'PAREA'); 
      const roomCountKey = findKey(row, '建物現況格局-房') || findKey(row, 'BUILD_R');

      let price = parseFloat(row[priceKey] || 0); 
      let total = parseFloat(row[totalKey] || 0);
      let totalArea = parseFloat(row[areaKey] || 0); 
      let parkArea = parseFloat(row[parkAreaKey] || 0); 
      
      let area = Math.max(0, totalArea - parkArea);

      const floor = row[floorKey] || "";
      const dateStr = row[dateKey] || "";
      const roomCountStr = roomCountKey ? (row[roomCountKey] || "").toString().trim() : "";

      if (price > 10000) price = price / 10000;
      if (total > 1000000) total = total / 10000;

      if (total > 0 || price > 0) {
        
        let dateObj = null;
        if(dateStr) {
            dateObj = parseROCDate(dateStr);
        }

        let roomType = "開放式格局";
        const roomCount = parseInt(roomCountStr);
        
        if (!isNaN(roomCount) && roomCount > 0) {
             if (roomCount === 1) roomType = "1房";
             else if (roomCount === 2) roomType = "2房";
             else if (roomCount === 3) roomType = "3房";
             else roomType = "4房"; 
        }

        const notes = row[noteKey] || "";
        const isSpecial = floor.includes("一") || floor === "1" || notes.includes("露台") || notes.includes("特殊");

        if (!grouped[name]) {
            grouped[name] = {
            district: district || "未知區域",
            name: name,
            address: address || "位置未詳",
            transactions: 0,
            totalPriceSum: 0,
            unitPrices: [],
            totalPrices: [],
            areas: [],
            dates: [], 
            dateObjects: [], 
            roomStats: {}, 
            parking: { count: 0, prices: [] },
            special: { count: 0 }
            };
        }
        
        const item = grouped[name];
        item.transactions += 1;
        
        if (price > 10) {
            item.unitPrices.push(price);
        }
        item.totalPrices.push(total);
        item.totalPriceSum += total;
        item.areas.push(area);
        
        if(dateStr) {
            item.dates.push(dateStr);
            if(dateObj) item.dateObjects.push(dateObj);
        }

        if (isSpecial) {
            item.special.count += 1;
        }

        if (!item.roomStats[roomType]) {
            item.roomStats[roomType] = { count: 0, areas: [], prices: [], totals: [] };
        }
        item.roomStats[roomType].count += 1;
        item.roomStats[roomType].areas.push(area); 
        if (price > 10) {
            item.roomStats[roomType].prices.push(price);
        }
        item.roomStats[roomType].totals.push(total);

        allTransactions.push({
            district: district || "",
            name: name,
            date: dateStr,
            dateObj: dateObj,
            price: price.toFixed(1),
            total: total.toFixed(0),
            area: area.toFixed(2),
            roomType: roomType,
            floor: floor,
            caseObject: caseObject
        });
      }

      let parkingVal = parseFloat(row[parkPriceKey] || 0);
      if (parkingVal > 10000) parkingVal = parkingVal / 10000;

      if (parkingVal > 0 && grouped[name]) {
          grouped[name].parking.count += 1;
          grouped[name].parking.prices.push(parkingVal);
      }
    });

    setDataStats({ totalRaw: rawData.length, presale: presaleCount, filtered: filteredCount });

    let results = Object.values(grouped).map((group: any) => {
      const validPrices = group.unitPrices;
      const minP = validPrices.length ? Math.min(...validPrices).toFixed(1) : "0";
      const maxP = validPrices.length ? Math.max(...validPrices).toFixed(1) : "0";
      const avgP = validPrices.length ? (validPrices.reduce((a: number, b: number) => a + b, 0) / validPrices.length).toFixed(1) : 0;
      
      const minA = group.areas.length ? Math.min(...group.areas).toFixed(2) : "0";
      const maxA = group.areas.length ? Math.max(...group.areas).toFixed(2) : "0";

      const minT = group.totalPrices.length ? Math.min(...group.totalPrices).toFixed(0) : "0";
      const maxT = group.totalPrices.length ? Math.max(...group.totalPrices).toFixed(0) : "0";

      const avgCar = group.parking.count ? Math.round(group.parking.prices.reduce((a: number, b: number) => a + b, 0) / group.parking.count) : 0;
      const minCar = group.parking.prices.length ? Math.min(...group.parking.prices) : 0;
      const maxCar = group.parking.prices.length ? Math.max(...group.parking.prices) : 0;

      const formattedRoomStats: any = {};
      Object.keys(group.roomStats).forEach(key => {
         const rs = group.roomStats[key] as RoomStat;
         const minArea = Math.min(...rs.areas).toFixed(1);
         const maxArea = Math.max(...rs.areas).toFixed(1);
         
         const minTotal = Math.min(...rs.totals).toFixed(0);
         const maxTotal = Math.max(...rs.totals).toFixed(0);

         const validRoomPrices = rs.prices;
         const minUnitP = validRoomPrices.length ? Math.min(...validRoomPrices).toFixed(1) : "0.0";
         const maxUnitP = validRoomPrices.length ? Math.max(...validRoomPrices).toFixed(1) : "0.0";
         
         formattedRoomStats[key] = {
             count: rs.count,
             areaRange: `${minArea}-${maxArea}坪`,
             totalRange: minTotal === maxTotal ? `${minTotal}萬` : `${minTotal}-${maxTotal}萬`,
             unitPriceRange: minUnitP === maxUnitP ? `${minUnitP}萬` : `${minUnitP}-${maxUnitP}萬`
         };
      });

      // Better Date Range Logic using dateObjects
      const validDates = group.dateObjects.filter((d: any) => d instanceof Date && !isNaN(d.getTime()));
      validDates.sort((a: Date, b: Date) => a.getTime() - b.getTime());
      
      let dateRange = "-";
      let latestDate = "-";

      if (validDates.length > 0) {
          const formatDate = (date: Date) => {
              const y = date.getFullYear() - 1911;
              const m = (date.getMonth() + 1).toString().padStart(2, '0');
              const d = date.getDate().toString().padStart(2, '0');
              return `${y}/${m}/${d}`;
          };
          const start = formatDate(validDates[0]);
          const end = formatDate(validDates[validDates.length - 1]);
          dateRange = start === end ? start : `${start} - ${end}`;
          latestDate = end;
      } else {
          // Fallback to string sort if date parsing failed
          group.dates.sort();
          const earliestStr = group.dates[0] || "-";
          const latestStr = group.dates[group.dates.length - 1] || "-";
          dateRange = (earliestStr === latestStr) ? latestStr : `${earliestStr} - ${latestStr}`;
      }

      return {
        ...group,
        priceRange: minP === maxP ? `${minP}` : `${minP} - ${maxP}`,
        avgPriceNum: parseFloat(avgP as string),
        totalAmount: `${Math.round(group.totalPriceSum / 10000)}億${Math.round(group.totalPriceSum % 10000)}萬`,
        rawTotalAmount: group.totalPriceSum,
        areaRange: `${minA} - ${maxA}`,
        totalPriceRange: `${minT} - ${maxT}`,
        roomTypes: formattedRoomStats,
        special: { count: group.special.count, desc: group.special.count > 0 ? `${group.special.count}戶` : "-" },
        parking: { 
            count: group.parking.count, 
            avg: avgCar ? `${avgCar}` : "-", 
            range: minCar ? `${minCar}-${maxCar}` : "-" 
        },
        dateRange: dateRange,
        lastDate: latestDate,
        transactions: group.transactions 
      };
    });

    results.sort((a: any, b: any) => {
        if (b.transactions !== a.transactions) {
            return b.transactions - a.transactions;
        }
        return b.rawTotalAmount - a.rawTotalAmount;
    });

    allTransactions.sort((a, b) => {
        if (!a.dateObj) return 1;
        if (!b.dateObj) return -1;
        return b.dateObj.getTime() - a.dateObj.getTime();
    });

    return { grouped: results, latest: allTransactions };
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;
        const text = decodeContent(buffer); 
        const rawData = parseCSV(text);
        const processed = processRawData(rawData);
        
        if(processed.grouped.length === 0 && rawData.length > 0) {
            console.log("Debug: First Row", rawData[0]);
            const firstRowJson = JSON.stringify(rawData[0], null, 2);
            setError(`篩選後無「預售屋」資料。請檢查下方偵測到的第一筆資料格式是否正確 (是否有亂碼?)：\n${firstRowJson}`);
        } else {
            setDisplayData(processed.grouped);
            setRecentTransactions(processed.latest);
            setDataSource('upload');
            setLastUpdated(new Date().toLocaleTimeString());
        }
      } catch (err) {
        console.error(err);
        setError("檔案解析失敗");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleTextUpload = () => {
      if(!csvText.trim()) return;
      setLoading(true);
      setError(null);
      try {
        const rawData = parseCSV(csvText);
        const processed = processRawData(rawData);
        setDisplayData(processed.grouped);
        setRecentTransactions(processed.latest);
        setDataSource('upload');
        setLastUpdated(new Date().toLocaleTimeString());
        if(processed.grouped.length === 0 && rawData.length > 0) {
             const firstRowJson = JSON.stringify(rawData[0], null, 2);
             setError(`解析成功但無資料。偵測到的第一筆資料：\n${firstRowJson}`);
        }
      } catch (err) {
        setError("文字解析失敗，請確認格式。");
      } finally {
        setLoading(false);
      }
  };

  const fetchData = async () => {
    if(!resourceId) return;
    setLoading(true);
    setError(null);
    
    let allFetchedData: Record<string, string>[] = [];
    let offset = 0;
    const limit = 1000;
    let hasMore = true;
    let pageCount = 0;
    const MAX_RECORDS = 30000; 

    try {
      while(hasMore) {
        pageCount++;
        const targetUrl = `https://data.taipei/api/v1/dataset/${resourceId}?scope=resourceAquire&format=csv&limit=${limit}&offset=${offset}&_t=${Date.now()}`; 
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

        console.log(`Fetching batch ${pageCount} (Offset: ${offset})...`);
        
        const response = await fetch(proxyUrl);
        
        if (!response.ok) {
            throw new Error(`連線失敗 (Batch ${pageCount}): ${response.status}`);
        }
        
        const buffer = await response.arrayBuffer();
        const csvData = decodeContent(buffer);
        
        if (!csvData || !csvData.includes(",")) {
            throw new Error("回傳資料格式錯誤 (非 CSV)");
        }

        const rawData = parseCSV(csvData);
        
        if (rawData.length === 0) {
            hasMore = false;
        } else {
            allFetchedData = [...allFetchedData, ...rawData];
            offset += limit;
            
            if (rawData.length < limit) {
                hasMore = false;
            }
            
            if (offset >= MAX_RECORDS) {
                hasMore = false;
            }
        }
        
        await new Promise(r => setTimeout(r, 100)); 
      }

      console.log(`Total fetched: ${allFetchedData.length} records.`);

      if (allFetchedData.length > 0) {
         const processed = processRawData(allFetchedData);
         
         if (processed.grouped.length === 0) {
             setError(`成功抓取 ${allFetchedData.length} 筆資料，但篩選後無「預售屋」資料。`);
         } else if (allFetchedData.length < 200) {
             console.warn("Data count low, likely weekly update only.");
         }

         setDisplayData(processed.grouped);
         setRecentTransactions(processed.latest);
         setLastUpdated(new Date().toLocaleTimeString());
         setDataSource('api'); 
         
         setDataStats({ 
             totalRaw: allFetchedData.length, 
             presale: processed.grouped.reduce((acc, g) => acc + g.transactions, 0), 
             filtered: allFetchedData.length - processed.grouped.reduce((acc, g) => acc + g.transactions, 0)
         });

      } else {
         setError("抓取成功但資料為空。");
      }

    } catch (err) {
      console.error("Fetch Error:", err);
      setError(`自動更新失敗 (CORS Proxy Error)。\n建議：請手動點擊「上傳 CSV」按鈕來載入資料。`);
      setDataSource('upload'); 
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateMarketAnalysis = async () => {
    if (displayData.length === 0) {
        setError("無資料可供分析，請先載入資料。");
        return;
    }

    setIsAnalyzing(true);
    setShowAnalysisPanel(true); 
    setError(null);

    const totalTransactions = displayData.reduce((acc, curr) => acc + curr.transactions, 0);
    const avgPriceOverall = (displayData.reduce((acc, curr) => acc + curr.avgPriceNum, 0) / displayData.length).toFixed(1);
    
    const districtStats: Record<string, { count: number, priceSum: number, projectCount: number }> = {};
    displayData.forEach(d => {
        if(!districtStats[d.district]) districtStats[d.district] = { count: 0, priceSum: 0, projectCount: 0 };
        districtStats[d.district].count += d.transactions;
        districtStats[d.district].priceSum += d.avgPriceNum;
        districtStats[d.district].projectCount += 1;
    });
    
    const districtSummary = Object.entries(districtStats).map(([dist, stats]) => ({
        district: dist,
        avgPrice: (stats.priceSum / stats.projectCount).toFixed(1),
        transactions: stats.count
    })).sort((a,b) => parseFloat(b.avgPrice) - parseFloat(a.avgPrice));

    const topExpensive = [...displayData].sort((a,b) => b.avgPriceNum - a.avgPriceNum).slice(0, 3);
    const topVolume = [...displayData].sort((a,b) => b.transactions - a.transactions).slice(0, 3);

    const promptText = `
      請扮演專業房產數據分析師，根據以下【台北市預售屋實價登錄數據】，提供一份**精簡、客觀、條列式**的重點分析。
      
      **原則：精簡扼要、事實導向、不說廢話、只講重點。**

      【數據摘要】
      - 總樣本：${displayData.length} 案 (共 ${totalTransactions} 筆成交)
      - 全市均價：${avgPriceOverall} 萬/坪
      
      - 區域行情 (均價 | 成交量)：
      ${districtSummary.map(d => `  * ${d.district}: ${d.avgPrice}萬 | ${d.transactions}戶`).join('\n')}
      
      - 單價 Top 3：
      ${topExpensive.map(d => `  * ${d.name} (${d.district}): ${d.priceRange}萬`).join('\n')}
      
      - 銷量 Top 3：
      ${topVolume.map(d => `  * ${d.name} (${d.district}): ${d.transactions}戶`).join('\n')}
      
      【輸出要求 (請使用 Markdown)】
      1. **價格事實**：簡述價格區間與天花板，點出最高價區域。
      2. **量能觀察**：指出交易最熱絡的區域或建案。
      3. **市場快評**：基於數據，用一句話總結目前市場狀態 (例如：價漲量縮、特定區域獨強等)。
      
      4. **各區成交詳情列表**：
      請直接將上方提供的【各行政區成交詳情】整理輸出，格式如下：
      ### 行政區
      * **案名** 單價(區間) 房型(區間) 成交筆數
    `;

    try {
        const text = await generateMarketAnalysis(promptText);
        setAnalysisResult(text);
    } catch (err) {
        setAnalysisResult("抱歉，AI 分析服務暫時無法使用，請稍後再試。");
    } finally {
        setIsAnalyzing(false);
    }
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatting) return;

    const userMsg: ChatMessage = { role: 'user', text: chatInput };
    setChatHistory(prev => [...prev, userMsg]);
    setChatInput("");
    setIsChatting(true);

    try {
        const aiResponseText = await generateChatResponse(chatHistory, userMsg.text);
        setChatHistory(prev => [...prev, { role: 'model', text: aiResponseText }]);
    } catch (err) {
        setChatHistory(prev => [...prev, { role: 'model', text: "抱歉，連線發生錯誤，請稍後再試。" }]);
    } finally {
        setIsChatting(false);
    }
  };

  const toggleAnalysisPanel = () => {
      setShowAnalysisPanel(!showAnalysisPanel);
      if (!showAnalysisPanel && !analysisResult && !isAnalyzing) {
          handleGenerateMarketAnalysis();
      }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
      let interval: any;
      if (autoUpdate && dataSource === 'api') {
          interval = setInterval(() => {
              const now = new Date();
              if (now.getDay() === 3 && now.getHours() === 12 && now.getMinutes() === 0) {
                  console.log("Weekly scheduled refresh triggered (Wed 12:00)");
                  fetchData();
              }
          }, 60000); 
      }
      return () => clearInterval(interval);
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoUpdate, dataSource]);

  const allRoomTypes = useMemo(() => {
    const types = new Set<string>();
    displayData.forEach(d => Object.keys(d.roomTypes).forEach(t => types.add(t)));
    const order = ["開放式格局", "1房", "2房", "3房", "4房"];
    return Array.from(types).sort((a, b) => {
        const idxA = order.indexOf(a);
        const idxB = order.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
    });
  }, [displayData]);

  const filteredData = useMemo(() => {
      if (!searchTerm) return displayData;
      return displayData.filter(item => 
          item.name.includes(searchTerm) || 
          item.district.includes(searchTerm) || 
          item.address.includes(searchTerm)
      );
  }, [displayData, searchTerm]);

  const priceRanking = useMemo(() => {
      return [...filteredData].sort((a, b) => b.avgPriceNum - a.avgPriceNum).slice(0, 10);
  }, [filteredData]);

  const volumeRanking = useMemo(() => {
      return [...filteredData].sort((a, b) => b.transactions - a.transactions).slice(0, 10);
  }, [filteredData]);

  const filteredRecent = useMemo(() => {
      if (!searchTerm) return recentTransactions;
      return recentTransactions.filter(item => 
          item.name.includes(searchTerm) || 
          item.district.includes(searchTerm)
      );
  }, [recentTransactions, searchTerm]);

  const districtStats = useMemo(() => {
    const stats: Record<string, number> = {};
    displayData.forEach(item => {
        if (!stats[item.district]) stats[item.district] = 0;
        stats[item.district] += item.transactions;
    });
    return Object.entries(stats)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
  }, [displayData]);

  const districtDetailList = useMemo(() => {
    const grouped: Record<string, GroupedData[]> = {};
    displayData.forEach(item => {
        if (!grouped[item.district]) {
            grouped[item.district] = [];
        }
        grouped[item.district].push(item);
    });
    
    const sortedDistricts = Object.entries(grouped).sort((a, b) => {
        const totalA = a[1].reduce((sum, item) => sum + item.transactions, 0);
        const totalB = b[1].reduce((sum, item) => sum + item.transactions, 0);
        return totalB - totalA;
    });

    sortedDistricts.forEach(d => {
        d[1].sort((a, b) => b.transactions - a.transactions);
    });

    return sortedDistricts;
  }, [displayData]);

  const handleDownloadMarketOverview = () => {
      if (!marketOverviewRef.current || !window.html2canvas) return;
      
      setIsGeneratingImage(true);
      
      window.html2canvas(marketOverviewRef.current, {
          scale: 2,
          useCORS: true,
          logging: false,
          windowWidth: 1200
      }).then((canvas: HTMLCanvasElement) => {
          const image = canvas.toDataURL("image/png");
          const link = document.createElement('a');
          link.href = image;
          link.download = `market-overview-${new Date().toISOString().slice(0,10)}.png`;
          link.click();
          setIsGeneratingImage(false);
      }).catch((err: any) => {
          console.error("Overview generation failed:", err);
          setIsGeneratingImage(false);
          alert("圖片生成失敗，請稍後再試。");
      });
  };

  const handleDownloadImage = () => {
      if (!reportContainerRef.current || !window.html2canvas) return;
      
      setIsGeneratingImage(true);
      
      window.html2canvas(reportContainerRef.current, {
          scale: 2, // Higher quality
          useCORS: true, // Handle cross-origin images if any
          logging: false,
          windowWidth: 1200 // Force width for consistency
      }).then((canvas: HTMLCanvasElement) => {
          const image = canvas.toDataURL("image/png");
          const link = document.createElement('a');
          link.href = image;
          link.download = `market-report-${new Date().toISOString().slice(0,10)}.png`;
          link.click();
          setIsGeneratingImage(false);
      }).catch((err: any) => {
          console.error("Image generation failed:", err);
          setIsGeneratingImage(false);
          alert("圖片生成失敗，請稍後再試。");
      });
  };

  const handleEnterReportMode = () => {
      setViewMode('report');
  };

  // --- RENDER ---

  // Report View Mode
  if (viewMode === 'report') {
      return (
        <div className="bg-gray-100 min-h-screen font-sans text-gray-800 p-4 md:p-8 flex flex-col items-center">
             {/* Toolbar */}
             <div className="w-full max-w-4xl bg-white p-4 rounded-xl shadow-sm mb-6 flex justify-between items-center sticky top-4 z-50">
                 <button onClick={() => setViewMode('dashboard')} className="flex items-center text-gray-600 hover:text-gray-900 font-medium transition-colors">
                     <ArrowLeft className="w-5 h-5 mr-2"/> 返回儀表板
                 </button>
                 <button 
                     onClick={handleDownloadImage} 
                     disabled={isGeneratingImage}
                     className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 flex items-center gap-2 font-bold shadow-lg transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                 >
                     {isGeneratingImage ? <Loader2 className="w-5 h-5 animate-spin"/> : <ImageIcon className="w-5 h-5"/>}
                     {isGeneratingImage ? "生成中..." : "下載報告圖片 (PNG)"}
                 </button>
             </div>

             {/* Report Content (Capture Target) */}
             <div ref={reportContainerRef} className="bg-white p-8 md:p-12 rounded-2xl shadow-xl w-full max-w-4xl">
                <div className="text-center mb-12">
                    <h1 className="text-4xl font-extrabold text-gray-900 mb-2">台北市預售屋市場分析報告</h1>
                    <p className="text-gray-500">生成時間: {new Date().toLocaleString()}</p>
                </div>

                {/* 1. AI Analysis */}
                {analysisResult && (
                    <div className="mb-12">
                        <div className="flex items-center gap-3 border-b-2 border-gray-900 pb-3 mb-6">
                            <Sparkles className="w-8 h-8 text-purple-600" />
                            <h2 className="text-2xl font-bold">AI 智能市場快評</h2>
                        </div>
                        <div className="prose prose-lg max-w-none whitespace-pre-line bg-gray-50 p-8 rounded-2xl border border-gray-100 leading-relaxed text-gray-700">
                            {analysisResult}
                        </div>
                    </div>
                )}

                {/* 2. Top Rankings */}
                <div className="mb-12">
                    <div className="flex items-center gap-3 border-b-2 border-gray-900 pb-3 mb-6">
                        <TrendingUp className="w-8 h-8 text-blue-600" />
                        <h2 className="text-2xl font-bold">價量排行榜 (Top 10)</h2>
                    </div>
                    <div className="grid grid-cols-2 gap-10">
                        <div>
                            <h3 className="font-bold text-lg mb-4 bg-red-50 p-3 text-center text-red-800 rounded-lg border border-red-100">單價排行 (高→低)</h3>
                            <table className="w-full text-sm border-collapse">
                                <thead>
                                    <tr className="bg-gray-100 border-b border-gray-300">
                                        <th className="p-2 w-10 text-center text-gray-500">#</th>
                                        <th className="p-2 text-left">建案名稱</th>
                                        <th className="p-2 text-right">單價區間</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {priceRanking.map((d, i) => (
                                        <tr key={i} className={i < 3 ? "bg-red-50/30" : ""}>
                                            <td className="p-2 text-center text-gray-500 font-mono">{i+1}</td>
                                            <td className="p-2 font-bold text-gray-800">{d.name}</td>
                                            <td className="p-2 text-right font-mono text-red-700 font-bold">{d.priceRange} 萬</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div>
                            <h3 className="font-bold text-lg mb-4 bg-blue-50 p-3 text-center text-blue-800 rounded-lg border border-blue-100">成交量排行 (多→少)</h3>
                            <table className="w-full text-sm border-collapse">
                                <thead>
                                    <tr className="bg-gray-100 border-b border-gray-300">
                                        <th className="p-2 w-10 text-center text-gray-500">#</th>
                                        <th className="p-2 text-left">建案名稱</th>
                                        <th className="p-2 text-right">成交筆數</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {volumeRanking.map((d, i) => (
                                        <tr key={i} className={i < 3 ? "bg-blue-50/30" : ""}>
                                            <td className="p-2 text-center text-gray-500 font-mono">{i+1}</td>
                                            <td className="p-2 font-bold text-gray-800">{d.name}</td>
                                            <td className="p-2 text-right font-mono text-blue-700 font-bold">{d.transactions} 戶</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* 3. Market Overview Chart */}
                <div className="mb-12">
                     <div className="flex items-center gap-3 border-b-2 border-gray-900 pb-3 mb-6">
                        <PieChart className="w-8 h-8 text-teal-600" />
                        <h2 className="text-2xl font-bold">行政區熱度概況</h2>
                    </div>
                    <div className="flex justify-center bg-white p-4 border border-gray-200 rounded-xl">
                        <svg width="800" height="300" viewBox="0 0 800 300">
                             {(() => {
                                const maxVal = Math.max(...districtStats.map(ds => ds.count), 1);
                                const barWidth = 40;
                                const gap = (700 - (districtStats.length * barWidth)) / (districtStats.length + 1);
                                return districtStats.map((d, i) => {
                                    const x = 50 + gap + i * (barWidth + gap);
                                    const height = (d.count / maxVal) * 200;
                                    const y = 250 - height;
                                    return (
                                        <g key={i}>
                                            <rect x={x} y={y} width={barWidth} height={height} fill="#0d9488" rx="2"/>
                                            <text x={x + barWidth/2} y={y - 8} textAnchor="middle" fontSize="12" fill="#4b5563" fontWeight="bold">{d.count}</text>
                                            <text x={x + barWidth/2} y="270" textAnchor="middle" fontSize="12" fill="#1f2937" fontWeight="bold">{d.name}</text>
                                        </g>
                                    );
                                });
                            })()}
                             <line x1="50" y1="250" x2="750" y2="250" stroke="#e5e7eb" strokeWidth="2" />
                        </svg>
                    </div>
                </div>

                {/* 4. District Details */}
                <div>
                    <div className="flex items-center gap-3 border-b-2 border-gray-900 pb-3 mb-6">
                        <MapPin className="w-8 h-8 text-teal-600" />
                        <h2 className="text-2xl font-bold">各行政區成交詳情列表</h2>
                    </div>
                    
                    {districtDetailList.map(([district, projects]) => (
                        <div key={district} className="mb-8 shadow-sm rounded-xl border border-gray-200 overflow-hidden overflow-x-auto break-inside-avoid">
                            <div className="flex items-center justify-between bg-teal-50 p-4 border-b border-teal-100 min-w-[600px]">
                                <h3 className="font-bold text-xl text-teal-900">{district}</h3>
                                <span className="flex items-center justify-center font-medium text-teal-700 bg-white px-3 py-1 rounded-full text-sm shadow-sm border border-teal-100 whitespace-nowrap flex-shrink-0">
                                    共 {projects.reduce((acc, curr) => acc + curr.transactions, 0)} 筆成交
                                </span>
                            </div>
                            <table className="w-full text-sm text-left min-w-[600px]">
                                <thead className="bg-gray-100 text-gray-600">
                                    <tr>
                                        <th className="p-3 font-semibold text-left whitespace-nowrap">建案名稱</th>
                                        <th className="p-3 text-right font-semibold whitespace-nowrap">單價區間 (萬/坪)</th>
                                        <th className="p-3 text-right font-semibold whitespace-nowrap">坪數區間</th>
                                        <th className="p-3 text-center font-semibold whitespace-nowrap">主力房型</th>
                                        <th className="p-3 text-center font-semibold whitespace-nowrap">交易時間</th>
                                        <th className="p-3 text-right font-semibold whitespace-nowrap">成交量</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {projects.map((project, idx) => {
                                        const roomTypes = Object.keys(project.roomTypes).filter(t => t.includes('房'));
                                        const nums = roomTypes.map(t => parseInt(t)).filter(n => !isNaN(n));
                                        let roomStr = "開放式格局";
                                        if (nums.length > 0) {
                                            const min = Math.min(...nums);
                                            const max = Math.max(...nums);
                                            roomStr = min === max ? `${min}房` : `${min}-${max}房`;
                                        } else if (project.roomTypes["開放式格局"]) {
                                            roomStr = "開放式格局";
                                        }

                                        return (
                                            <tr key={idx} className="hover:bg-gray-50/50">
                                                <td className="p-3 font-bold text-gray-800 text-left max-w-[200px]" title={project.name}>
                                                    <div className="truncate">{project.name}</div>
                                                </td>
                                                <td className="p-3 text-right font-mono text-red-600 font-bold whitespace-nowrap">{project.priceRange}</td>
                                                <td className="p-3 text-right text-gray-600 whitespace-nowrap">{project.areaRange}</td>
                                                <td className="p-3 text-center text-blue-600 font-medium whitespace-nowrap">{roomStr}</td>
                                                <td className="p-3 text-center text-gray-500 text-xs whitespace-nowrap">{project.dateRange}</td>
                                                <td className="p-3 text-right font-bold whitespace-nowrap">{project.transactions}</td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ))}
                </div>
            </div>
        </div>
      );
  }

  // Dashboard View Mode
  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8 font-sans text-gray-800">
      {/* ... styles ... */}
      <style>{`
        .animate-spin-slow { animation: spin 3s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none;  scrollbar-width: none; }
      `}</style>

      <div className="max-w-[1800px] mx-auto">
        {/* ... Header ... */}
        <header className="mb-6">
           <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
              <div className="flex items-center space-x-3">
                <BarChart3 className="w-8 h-8 text-blue-600" />
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center">
                        即時預售個案監控系統
                        {loading && <RefreshCw className="ml-3 w-5 h-5 animate-spin text-gray-400" />}
                    </h1>
                    <div className="text-gray-500 text-sm mt-1 flex items-center gap-2">
                         <span className={`w-2 h-2 rounded-full ${dataSource === 'api' ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></span>
                         狀態：{dataSource === 'upload' ? '離線模式' : '連線模式 (Auto-Fetch)'}
                         {lastUpdated && <span className="text-xs ml-2 bg-gray-100 px-2 py-0.5 rounded text-gray-600">更新: {lastUpdated}</span>}
                         {dataStats.totalRaw > 0 && (
                             <div className="flex items-center ml-2 bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs border border-blue-100">
                                 <HelpCircle className="w-3 h-3 mr-1"/>
                                 {dataStats.totalRaw < 200 ? "本期新增資料 (按週)" : `已載入 ${dataStats.totalRaw} 筆`}
                             </div>
                         )}
                    </div>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-2 items-center">
                 {/* Print Report Button */}
                 <button 
                    onClick={handleEnterReportMode}
                    className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm border bg-white text-gray-700 hover:bg-gray-50 shadow-sm transition-colors"
                 >
                    <ImageIcon className="w-4 h-4" />
                    下載完整報告 (PNG)
                 </button>

                 <button 
                    onClick={toggleAnalysisPanel}
                    className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm border transition-all shadow-sm ${showAnalysisPanel ? 'bg-purple-100 border-purple-300 text-purple-700' : 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:opacity-90'}`}
                 >
                    {showAnalysisPanel ? <X className="w-4 h-4"/> : <Sparkles className="w-4 h-4" />}
                    {showAnalysisPanel ? '隱藏 AI 分析' : 'AI 智能市場分析'}
                 </button>

                 <button 
                    onClick={() => setAutoUpdate(!autoUpdate)}
                    className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm border transition-colors ${autoUpdate ? 'bg-green-50 border-green-200 text-green-700' : 'bg-white border-gray-200 text-gray-500'}`}
                 >
                    <Clock className={`w-4 h-4 ${autoUpdate ? 'animate-spin-slow' : ''}`} />
                    {autoUpdate ? '監控中 (週三 12:00)' : '監控暫停'}
                 </button>
                 
                 <div className="relative">
                     <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                     <input 
                        type="text" 
                        placeholder="搜尋建案..." 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-32 lg:w-48"
                     />
                 </div>

                 <div className="flex bg-white rounded-lg border p-1 shadow-sm h-10 overflow-hidden">
                    <button 
                        onClick={() => { setDataSource('api'); fetchData(); }} 
                        className={`px-4 text-sm rounded-md transition-colors flex items-center ${dataSource === 'api' ? 'bg-blue-50 font-bold text-blue-700' : 'text-gray-500 hover:bg-gray-50'}`}
                    >
                        <Database className="w-4 h-4 mr-1" />
                        重連
                    </button>
                    <button 
                        onClick={() => setDataSource('upload')} 
                        className={`px-4 text-sm rounded-md transition-colors flex items-center ${dataSource === 'upload' ? 'bg-emerald-50 font-bold text-emerald-700' : 'text-gray-500 hover:bg-gray-50'}`}
                    >
                        <Upload className="w-4 h-4 mr-1" />
                        手動
                    </button>
                 </div>
              </div>
           </div>

           {/* ... Info Boxes ... */}
           {dataSource === 'api' && (
               <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-3 mb-4 flex flex-wrap items-center gap-4 text-xs text-blue-800">
                   <Info className="w-4 h-4" />
                   <span>系統正透過 Proxy 自動分頁抓取台北市實價登錄 CSV。若筆數較少，代表目前只有本期新增資料。</span>
               </div>
           )}

           {dataSource === 'upload' && (
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 animate-in slide-in-from-top-2">
                   <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-6 text-center border-dashed border-2 border-emerald-200 flex flex-col justify-center items-center cursor-pointer hover:bg-emerald-100 transition-colors" onClick={() => fileInputRef.current?.click()}>
                       <input type="file" accept=".csv,text/csv" onChange={handleFileUpload} ref={fileInputRef} className="hidden" />
                       <Upload className="w-8 h-8 text-emerald-600 mb-2" />
                       <h3 className="font-bold text-emerald-800">上傳 CSV 檔案</h3>
                       <p className="text-xs text-emerald-600">RPWeekData.csv (支援 Big5/UTF-8)</p>
                   </div>
                   <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col">
                       <textarea 
                           className="flex-grow w-full p-2 border border-gray-200 rounded text-xs font-mono mb-2 resize-none h-20 focus:ring-2 focus:ring-blue-500 outline-none"
                           placeholder="連線失敗時，可直接將 CSV 文字內容貼在這裡..."
                           value={csvText}
                           onChange={(e) => setCsvText(e.target.value)}
                       />
                       <button 
                           onClick={handleTextUpload}
                           className="w-full py-2 bg-slate-700 text-white rounded text-sm hover:bg-slate-800 flex items-center justify-center gap-2 transition-colors"
                       >
                           <Clipboard className="w-4 h-4" /> 解析貼上內容
                       </button>
                   </div>
               </div>
           )}

            {error && (
                <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-r flex items-start animate-in fade-in overflow-x-auto">
                    <AlertTriangle className="w-5 h-5 text-red-500 mr-3 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-red-700 font-medium whitespace-pre-wrap font-mono">{error}</div>
                </div>
            )}
        </header>

        <div className="flex flex-col lg:flex-row gap-6 items-start">
            
            {/* Left Column: Data Display */}
            <div className="flex-1 w-full min-w-0 flex flex-col">
                
                {displayData.length > 0 && (
                    <div className="mb-6 flex flex-wrap gap-4 text-sm items-center">
                        <div className="bg-white px-3 py-1 rounded-full border shadow-sm flex items-center"><FileText className="w-3 h-3 mr-1 text-gray-400"/> 原始筆數：<span className="font-bold ml-1">{dataStats.totalRaw}</span></div>
                        <div className="bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100 text-emerald-700 flex items-center"><Home className="w-3 h-3 mr-1"/> 預售交易：<span className="font-bold ml-1">{dataStats.presale}</span></div>
                        <div className="bg-blue-50 px-3 py-1 rounded-full border border-blue-100 text-blue-700 flex items-center"><Building2 className="w-3 h-3 mr-1"/> 建案數量：<span className="font-bold ml-1">{displayData.length}</span></div>
                    </div>
                )}

                <div className="flex space-x-2 mb-4 bg-gray-200 p-1 rounded-lg w-fit">
                    <button onClick={() => setActiveTab('table')} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'table' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600'}`}>總表比較</button>
                    <button onClick={() => setActiveTab('cards')} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'cards' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600'}`}>個案詳情</button>
                    <button onClick={() => setActiveTab('analysis')} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'analysis' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-600'}`}>價量分析</button>
                    <button onClick={() => setActiveTab('market')} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'market' ? 'bg-white text-teal-600 shadow-sm' : 'text-gray-600'}`}>市場概況</button>
                    <button onClick={() => setActiveTab('recent')} className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'recent' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-600'}`}>全部交易紀錄</button>
                </div>

                {loading ? (
                    <div className="h-64 flex flex-col items-center justify-center bg-white rounded-xl border">
                        <RefreshCw className="w-10 h-10 animate-spin text-blue-300 mb-2" />
                        <p className="text-gray-400 text-sm">正在連線至政府資料庫 (上限 30000 筆)...</p>
                        <p className="text-xs text-gray-300 mt-1">使用 corsproxy.io 進行中轉</p>
                    </div>
                ) : (
                <>
                    {activeTab === 'table' && (
                         <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                             <div 
                                ref={topScrollContainerRef}
                                onScroll={() => handleScroll('top')}
                                className="overflow-x-auto border-b border-gray-100 bg-gray-50"
                                style={{ overflowX: 'auto', overflowY: 'hidden' }}
                            >
                                <div style={{ width: (filteredData.length * 220 + 140) + 'px', height: '1px' }}></div>
                            </div>
                            <div 
                                ref={tableContainerRef}
                                onScroll={() => handleScroll('table')}
                                className="overflow-x-auto relative max-h-[700px]"
                            >
                                <table className="w-full text-left border-collapse" style={{ minWidth: (filteredData.length * 220 + 140) + 'px' }}>
                                <thead>
                                    <tr className="bg-slate-50 text-slate-700 text-sm border-b border-gray-200 sticky top-0 z-30 shadow-sm">
                                    <th className="p-4 font-bold whitespace-nowrap sticky left-0 top-0 bg-slate-50 z-50 border-r border-b w-[140px] shadow-[2px_2px_5px_-2px_rgba(0,0,0,0.1)]">
                                        項目 \ 建案
                                        <div className="text-[10px] text-gray-400 font-normal mt-1">(共 {filteredData.length} 案)</div>
                                    </th>
                                    {filteredData.map((item, idx) => (
                                        <th key={idx} className="p-4 min-w-[200px] text-center border-r border-b last:border-r-0 relative group hover:bg-slate-100 transition-colors bg-slate-50 sticky top-0 z-40">
                                        <div className="text-xs font-bold text-slate-500 mb-1 tracking-wider bg-white/50 inline-block px-2 rounded-full border">{item.district}</div>
                                        <div className="text-xl font-extrabold truncate px-1" title={item.name}>{item.name}</div>
                                        </th>
                                    ))}
                                    </tr>
                                </thead>
                                <tbody className="text-sm text-gray-700 divide-y divide-gray-100">
                                    <tr className="hover:bg-slate-50/50">
                                    <td className="p-3 font-semibold bg-slate-50 sticky left-0 border-r text-slate-600 z-30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">基地位置</td>
                                    {filteredData.map((item, idx) => (
                                        <td key={idx} className="p-3 text-center border-r text-sm text-slate-600 break-words max-w-[200px] leading-tight">{item.address}</td>
                                    ))}
                                    </tr>
                                    <tr className="hover:bg-slate-50/50 bg-yellow-50/20">
                                    <td className="p-3 font-semibold bg-slate-50 sticky left-0 border-r text-slate-600 z-30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">單價區間 / 筆數</td>
                                    {filteredData.map((item, idx) => (
                                        <td key={idx} className="p-3 text-center border-r">
                                        <div className="flex flex-col items-center">
                                            <span className="text-2xl font-bold text-red-600 mb-1">{item.priceRange} <span className="text-xs font-medium text-gray-500">萬</span></span>
                                            <span className="text-sm bg-white border text-slate-500 px-2 py-0.5 rounded-full">{item.transactions} 筆</span>
                                        </div>
                                        </td>
                                    ))}
                                    </tr>
                                    {allRoomTypes.map(roomType => (
                                        <tr key={roomType} className="hover:bg-slate-50/50">
                                            <td className="p-3 font-semibold bg-slate-50 sticky left-0 border-r text-slate-600 z-30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] flex flex-col justify-center h-full min-h-[60px]">
                                                {roomType}
                                                <span className="text-[10px] font-normal text-gray-400">房屋坪 | 單價 | 總價</span>
                                            </td>
                                            {filteredData.map((item, idx) => {
                                                const data = item.roomTypes[roomType];
                                                return (
                                                    <td key={idx} className="p-3 text-center border-r align-top">
                                                        {data ? (
                                                            <div className="flex flex-col gap-1">
                                                                <div className="flex items-center justify-center gap-1">
                                                                    <span className="text-[10px] bg-slate-100 px-1 rounded">{data.count}戶</span>
                                                                    <div className="text-xs text-gray-600 font-medium">{data.areaRange}</div>
                                                                </div>
                                                                <div className="text-sm font-bold text-orange-600">{data.unitPriceRange}/坪</div>
                                                                <span className="text-base font-bold text-blue-600">{data.totalRange}</span>
                                                            </div>
                                                        ) : <span className="text-gray-200">-</span>}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                    <tr className="hover:bg-slate-50/50">
                                    <td className="p-3 font-semibold bg-slate-50 sticky left-0 border-r text-slate-600 z-30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">特殊 / 一樓</td>
                                    {filteredData.map((item, idx) => (
                                        <td key={idx} className="p-3 text-center border-r text-xs text-slate-500">
                                        {item.special.count > 0 ? (
                                            <span className="bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded font-bold">{item.special.desc}</span>
                                        ) : "-"}
                                        </td>
                                    ))}
                                    </tr>
                                    <tr className="hover:bg-slate-50/50">
                                    <td className="p-3 font-semibold bg-slate-50 sticky left-0 border-r text-slate-600 z-30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">揭露總銷</td>
                                    {filteredData.map((item, idx) => (
                                        <td key={idx} className="p-3 text-center border-r font-bold text-lg text-slate-800 bg-blue-50/10">
                                        {item.totalAmount}
                                        </td>
                                    ))}
                                    </tr>
                                    <tr className="hover:bg-slate-50/50 border-t-2 border-slate-100">
                                    <td className="p-3 font-semibold bg-slate-50 sticky left-0 border-r text-slate-600 z-30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">車位資訊</td>
                                    {filteredData.map((item, idx) => (
                                        <td key={idx} className="p-3 text-center border-r align-middle">
                                            <div className="flex flex-col items-center justify-center gap-1">
                                                <div className="text-sm">
                                                    <span className="font-bold mr-1">{item.parking.count} 車</span>
                                                    {item.parking.avg !== "-" && <span className="text-blue-600 font-medium">({item.parking.avg}萬)</span>}
                                                </div>
                                                {item.parking.range !== "-" && (
                                                    <div className="text-xs text-slate-400 font-mono">
                                                        範圍: {item.parking.range} <span className="text-[10px]">萬</span>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                    ))}
                                    </tr>
                                    <tr className="hover:bg-slate-50/50">
                                    <td className="p-3 font-semibold bg-slate-50 sticky left-0 border-r text-slate-600 z-30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">交易時間</td>
                                    {filteredData.map((item, idx) => (
                                        <td key={idx} className="p-3 text-center border-r text-sm text-slate-600 font-medium">
                                        {item.dateRange}
                                        </td>
                                    ))}
                                    </tr>
                                </tbody>
                                </table>
                            </div>
                         </div>
                    )}
                    
                    {/* ... Other Tabs ... */}
                    {activeTab === 'cards' && (
                         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {filteredData.map((item, idx) => (
                            <div key={idx} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col hover:shadow-md transition-shadow">
                                <div className="p-5 border-b bg-white flex justify-between items-start">
                                    <div className="flex-1 mr-2">
                                        <span className="inline-block px-3 py-1 rounded text-sm font-bold bg-gray-100 text-gray-600 mb-2">{item.district}</span>
                                        <h3 className="text-2xl font-extrabold text-gray-900 leading-tight" title={item.name}>{item.name}</h3>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-3xl font-bold text-red-600">{item.priceRange}</div>
                                        <div className="text-sm text-gray-500 mt-1">萬/坪</div>
                                    </div>
                                </div>
                                <div className="p-5 space-y-6 text-sm flex-grow">
                                    <div className="flex items-start gap-2 text-gray-600 text-sm">
                                        <MapPin className="w-5 h-5 mt-0.5 text-gray-400 shrink-0" />
                                        <span className="line-clamp-2">{item.address}</span>
                                    </div>
                                    
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                                            <div className="text-sm text-gray-500 mb-1">交易筆數</div>
                                            <div className="text-xl font-bold text-gray-800">{item.transactions} <span className="text-sm font-normal text-gray-500">筆</span></div>
                                        </div>
                                        <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                                            <div className="text-sm text-gray-500 mb-1">總銷金額</div>
                                            <div className="text-xl font-bold text-blue-700">{item.totalAmount}</div>
                                        </div>
                                    </div>

                                    <div className="border-t pt-4">
                                        <p className="text-sm font-bold text-gray-700 mb-3 flex items-center">
                                            <Home className="w-4 h-4 mr-2 text-blue-500"/> 主力房型分析
                                        </p>
                                        <div className="space-y-3">
                                            {Object.entries(item.roomTypes).slice(0, 3).map(([type, data]: [string, any]) => (
                                                <div key={type} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                                                    <div className="flex flex-col">
                                                        <div className="flex items-baseline gap-2">
                                                            <span className="text-base font-bold text-gray-800">{type}</span>
                                                            <span className="text-sm text-gray-500">({data.areaRange} 房屋坪 (不含車))</span>
                                                        </div>
                                                        <span className="text-sm font-medium text-orange-600 mt-0.5">單價: {data.unitPriceRange}/坪</span>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-lg font-bold text-blue-700">{data.totalRange}</div>
                                                        <div className="text-sm text-gray-400 mt-0.5">成交 {data.count} 戶</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-gray-50 px-5 py-3 border-t text-sm text-gray-500 text-right font-medium flex justify-between items-center">
                                    <span className="flex items-center gap-2"><Clock className="w-4 h-4"/> 交易期間</span>
                                    <span>{item.dateRange}</span>
                                </div>
                            </div>
                            ))}
                        </div>
                    )}
                    
                    {activeTab === 'analysis' && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-2">
                             <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                <div className="p-4 border-b bg-gradient-to-r from-red-50 to-white flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="bg-red-100 p-2 rounded-lg">
                                            <DollarSign className="w-5 h-5 text-red-600" />
                                        </div>
                                        <h3 className="font-bold text-gray-800 text-lg">單價排行 (Top 10)</h3>
                                    </div>
                                    <span className="text-xs text-gray-500 bg-white px-2 py-1 rounded border">由高至低</span>
                                </div>
                                <div className="divide-y divide-gray-100">
                                    <div className="grid grid-cols-12 bg-gray-50 p-3 text-xs font-medium text-gray-500">
                                        <div className="col-span-1 text-center">排名</div>
                                        <div className="col-span-6">建案名稱</div>
                                        <div className="col-span-5 text-right">單價區間</div>
                                    </div>
                                    {priceRanking.map((item, idx) => (
                                        <div key={idx} className="grid grid-cols-12 p-3 text-sm hover:bg-red-50/30 transition-colors items-center">
                                            <div className="col-span-1 text-center font-bold text-gray-400">{idx + 1}</div>
                                            <div className="col-span-6">
                                                <div className="font-bold text-gray-800 truncate" title={item.name}>{item.name}</div>
                                                <div className="text-xs text-gray-400">{item.district}</div>
                                            </div>
                                            <div className="col-span-5 text-right font-bold text-red-600">{item.priceRange} <span className="text-xs text-gray-400 font-normal">萬</span></div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                             <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                <div className="p-4 border-b bg-gradient-to-r from-purple-50 to-white flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="bg-purple-100 p-2 rounded-lg">
                                            <TrendingUp className="w-5 h-5 text-purple-600" />
                                        </div>
                                        <h3 className="font-bold text-gray-800 text-lg">成交量排行 (Top 10)</h3>
                                    </div>
                                    <span className="text-xs text-gray-500 bg-white px-2 py-1 rounded border">累積成交戶數</span>
                                </div>
                                <div className="divide-y divide-gray-100">
                                    <div className="grid grid-cols-12 bg-gray-50 p-3 text-xs font-medium text-gray-500">
                                        <div className="col-span-2 text-center">排名</div>
                                        <div className="col-span-7">建案名稱</div>
                                        <div className="col-span-3 text-right">總銷量</div>
                                    </div>
                                    {volumeRanking.map((item, idx) => (
                                        <div key={idx} className="grid grid-cols-12 p-3 text-sm hover:bg-purple-50/30 transition-colors items-center">
                                            <div className="col-span-2 text-center font-bold text-gray-400">{idx + 1}</div>
                                            <div className="col-span-7">
                                                <div className="font-bold text-gray-800 truncate" title={item.name}>{item.name}</div>
                                                <div className="text-xs text-gray-400">{item.district}</div>
                                            </div>
                                            <div className="col-span-3 text-right">
                                                <span className="font-bold text-purple-600 text-lg">{item.transactions}</span>
                                                <span className="text-xs text-gray-400 ml-1">戶</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* NEW MARKET TAB */}
                    {activeTab === 'market' && (
                        <div ref={marketOverviewRef} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden animate-in fade-in">
                            <div className="p-4 border-b bg-gradient-to-r from-teal-50 to-white flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <PieChart className="w-5 h-5 text-teal-600" />
                                    <h3 className="font-bold text-gray-800 text-lg">行政區交易熱度 (總成交量)</h3>
                                </div>
                                <button 
                                    onClick={handleDownloadMarketOverview}
                                    disabled={isGeneratingImage}
                                    className="flex items-center gap-1 text-sm bg-white border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors disabled:opacity-50"
                                >
                                    {isGeneratingImage ? <Loader2 className="w-4 h-4 animate-spin"/> : <Download className="w-4 h-4" />}
                                    {isGeneratingImage ? "生成中..." : "下載完整報表 (PNG)"}
                                </button>
                            </div>
                            <div className="p-8 flex justify-center bg-white overflow-x-auto">
                                {/* SVG Chart */}
                                <svg 
                                    ref={chartRef}
                                    width={Math.max(800, districtStats.length * 60 + 100)} 
                                    height="400" 
                                    className="w-full max-w-4xl"
                                    xmlns="http://www.w3.org/2000/svg"
                                    style={{ minWidth: '800px' }}
                                >
                                    {/* Background */}
                                    <rect width="100%" height="100%" fill="white" />
                                    
                                    {/* Axis Lines */}
                                    <line x1="50" y1="350" x2={Math.max(750, districtStats.length * 60 + 50)} y2="350" stroke="#e5e7eb" strokeWidth="2" />
                                    
                                    {/* Bars */}
                                    {districtStats.length === 0 ? (
                                        <text x="400" y="200" textAnchor="middle" fill="#9ca3af">無數據</text>
                                    ) : (
                                        districtStats.map((d, i) => {
                                            const maxVal = Math.max(...districtStats.map(ds => ds.count), 1);
                                            const barWidth = 40;
                                            const gap = 20; 
                                            const startX = 50;
                                            const x = startX + i * (barWidth + gap);
                                            const height = (d.count / maxVal) * 300;
                                            const y = 350 - height;
                                            
                                            return (
                                                <g key={i} className="group">
                                                    <rect 
                                                        x={x} 
                                                        y={y} 
                                                        width={barWidth} 
                                                        height={height} 
                                                        fill="#0d9488" 
                                                        rx="4"
                                                        className="hover:opacity-80 transition-opacity cursor-pointer"
                                                    >
                                                        <title>{d.name}: {d.count}筆</title>
                                                    </rect>
                                                    <text 
                                                        x={x + barWidth/2} 
                                                        y={y - 10} 
                                                        textAnchor="middle" 
                                                        fontSize="12" 
                                                        fill="#666" 
                                                        fontWeight="bold"
                                                    >
                                                        {d.count}
                                                    </text>
                                                    <text 
                                                        x={x + barWidth/2} 
                                                        y="370" 
                                                        textAnchor="middle" 
                                                        fontSize="12" 
                                                        fill="#374151"
                                                        fontWeight="500"
                                                    >
                                                        {d.name}
                                                    </text>
                                                </g>
                                            );
                                        })
                                    )}
                                </svg>
                            </div>

                            {/* Detailed District Lists */}
                            <div className="p-6 bg-gray-50">
                                {districtDetailList.map(([district, projects]) => (
                                    <div key={district} className="mb-8 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden overflow-x-auto">
                                        <div className="flex items-center justify-between bg-teal-50 p-4 border-b border-teal-100 min-w-[600px]">
                                            <h3 className="font-bold text-xl text-teal-900">{district}</h3>
                                            <span className="flex items-center justify-center font-medium text-teal-700 bg-white px-3 py-1 rounded-full text-sm shadow-sm border border-teal-100 whitespace-nowrap flex-shrink-0">
                                                共 {projects.reduce((acc, curr) => acc + curr.transactions, 0)} 筆成交
                                            </span>
                                        </div>
                                        <table className="w-full text-sm text-left min-w-[600px]">
                                            <thead className="bg-gray-100 text-gray-600">
                                                <tr>
                                                    <th className="p-3 font-semibold text-left whitespace-nowrap">建案名稱</th>
                                                    <th className="p-3 text-right font-semibold whitespace-nowrap">單價區間 (萬/坪)</th>
                                                    <th className="p-3 text-right font-semibold whitespace-nowrap">坪數區間</th>
                                                    <th className="p-3 text-center font-semibold whitespace-nowrap">主力房型</th>
                                                    <th className="p-3 text-center font-semibold whitespace-nowrap">交易時間</th>
                                                    <th className="p-3 text-right font-semibold whitespace-nowrap">成交量</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {projects.map((project, idx) => {
                                                    const roomTypes = Object.keys(project.roomTypes).filter(t => t.includes('房'));
                                                    const nums = roomTypes.map(t => parseInt(t)).filter(n => !isNaN(n));
                                                    let roomStr = "開放式格局";
                                                    if (nums.length > 0) {
                                                        const min = Math.min(...nums);
                                                        const max = Math.max(...nums);
                                                        roomStr = min === max ? `${min}房` : `${min}-${max}房`;
                                                    } else if (project.roomTypes["開放式格局"]) {
                                                        roomStr = "開放式格局";
                                                    }

                                                    return (
                                                        <tr key={idx} className="hover:bg-gray-50/50">
                                                            <td className="p-3 font-bold text-gray-800 text-left max-w-[200px]" title={project.name}>
                                                                <div className="truncate">{project.name}</div>
                                                            </td>
                                                            <td className="p-3 text-right font-mono text-red-600 font-bold whitespace-nowrap">{project.priceRange}</td>
                                                            <td className="p-3 text-right text-gray-600 whitespace-nowrap">{project.areaRange}</td>
                                                            <td className="p-3 text-center text-blue-600 font-medium whitespace-nowrap">{roomStr}</td>
                                                            <td className="p-3 text-center text-gray-500 text-xs whitespace-nowrap">{project.dateRange}</td>
                                                            <td className="p-3 text-right font-bold whitespace-nowrap">{project.transactions}</td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    
                    {activeTab === 'recent' && (
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                             <div className="p-4 border-b bg-gradient-to-r from-orange-50 to-white">
                                <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2">
                                    <List className="w-5 h-5 text-orange-600"/> 全部交易明細 (最新順序)
                                </h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-gray-100 text-gray-600">
                                        <tr>
                                            <th className="p-3 whitespace-nowrap">交易日期</th>
                                            <th className="p-3 whitespace-nowrap">建案名稱 / 行政區</th>
                                            <th className="p-3 whitespace-nowrap">樓層</th>
                                            <th className="p-3 text-right whitespace-nowrap">單價 (萬/坪)</th>
                                            <th className="p-3 text-right whitespace-nowrap">總價 (萬)</th>
                                            <th className="p-3 text-right whitespace-nowrap">建坪</th>
                                            <th className="p-3 text-center whitespace-nowrap">格局</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {filteredRecent.slice(0, 500).map((t, i) => (
                                            <tr key={i} className="hover:bg-gray-50/50">
                                                <td className="p-3 text-gray-500 font-mono text-xs">{t.date}</td>
                                                <td className="p-3">
                                                    <div className="font-bold text-gray-800">{t.name}</div>
                                                    <div className="text-xs text-gray-400">{t.district}</div>
                                                </td>
                                                <td className="p-3 text-gray-600">{t.floor}</td>
                                                <td className="p-3 text-right font-bold text-orange-600 font-mono">{t.price}</td>
                                                <td className="p-3 text-right text-gray-700 font-mono">{t.total}</td>
                                                <td className="p-3 text-right text-gray-500 font-mono">{t.area}</td>
                                                <td className="p-3 text-center text-blue-600 font-medium">{t.roomType}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {filteredRecent.length > 500 && (
                                    <div className="p-4 text-center text-gray-400 text-xs border-t bg-gray-50">
                                        僅顯示前 500 筆資料 (共 {filteredRecent.length} 筆)
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </>
                )}
            </div>

            {/* Right Column: AI Panel */}
            {(showAnalysisPanel || isChatting) && (
                <div className="w-full lg:w-80 xl:w-96 flex-shrink-0 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col h-[calc(100vh-120px)] sticky top-24 animate-in slide-in-from-right-4">
                    <div className="p-4 border-b bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-t-xl flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <Sparkles className="w-5 h-5" />
                            <h3 className="font-bold">AI 房市助手</h3>
                        </div>
                        <button 
                            onClick={() => setShowAnalysisPanel(false)}
                            className="hover:bg-white/20 p-1 rounded transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
                        {/* Analysis Section */}
                        {analysisResult && (
                            <div className="bg-white p-4 rounded-xl border border-purple-100 shadow-sm">
                                <div className="flex items-center gap-2 mb-2 text-purple-700 font-bold border-b border-purple-50 pb-2">
                                    <BarChart3 className="w-4 h-4" />
                                    <span>市場分析報告</span>
                                </div>
                                <div className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">
                                    {analysisResult}
                                </div>
                            </div>
                        )}

                        {/* Chat History */}
                        {chatHistory.length > 0 && (
                            <div className="space-y-4">
                                {chatHistory.map((msg, idx) => (
                                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[85%] p-3 rounded-2xl text-sm ${
                                            msg.role === 'user' 
                                            ? 'bg-blue-600 text-white rounded-br-none shadow-md' 
                                            : 'bg-white border border-gray-200 text-gray-800 rounded-bl-none shadow-sm'
                                        }`}>
                                            {msg.text}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        
                        {isChatting && (
                            <div className="flex justify-start">
                                <div className="bg-white border border-gray-200 p-3 rounded-2xl rounded-bl-none shadow-sm flex items-center gap-2 text-gray-500 text-sm">
                                    <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                                    <span>AI 正在分析數據...</span>
                                </div>
                            </div>
                        )}
                        <div ref={chatEndRef} />
                    </div>

                    <div className="p-3 bg-white border-t rounded-b-xl">
                        <form onSubmit={handleChatSubmit} className="relative">
                            <input 
                                type="text" 
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                placeholder="輸入問題..." 
                                className="w-full pl-4 pr-10 py-3 bg-gray-100 border-transparent focus:bg-white focus:border-blue-500 border rounded-xl text-sm transition-all outline-none"
                                disabled={isChatting}
                            />
                            <button 
                                type="submit" 
                                disabled={!chatInput.trim() || isChatting}
                                className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:bg-gray-400 transition-colors shadow-sm"
                            >
                                <Send className="w-4 h-4" />
                            </button>
                        </form>
                    </div>
                </div>
            )}

        </div> {/* End of flex-row */}
      </div> {/* End of max-w */}
    </div> {/* End of min-h-screen */}
  );
};

export default App;
