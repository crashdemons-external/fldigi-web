#include <emscripten/emscripten.h>
#include <memory>
#include <sstream>
#include "web_compat.h"
#include "psk.h"
#include "dominoex.h"
#include "throb.h"
#include "mt63.h"
#include "olivia.h"
#include "contestia.h"
#include "rtty.h"
#include "cw.h"
#include "mfsk.h"
#include "thor.h"
#include "scamp.h"
#include "ifkp.h"
#include "feld.h"
#include "navtex.h"
#include "fsq.h"
#include "wefax.h"
#include "gfft.h"
#include "charsetdistiller.h"
#include "web_dtmf.h"
#include "web_picture.h"
#include "web_wefax.h"

WebConfiguration progdefaults;
WebStatus progStatus;
waterfall waterfall_instance;
waterfall* wf=&waterfall_instance;
Widget widget;
Cserial rigio;
Widget *dlgViewer=&widget,*test_signal_window=&widget,*btn_imd_on=&widget,*xmtimd=&widget;
bool mailserver=false,mailclient=false,bHistory=false,bHighSpeed=false;
modem* active_modem=nullptr;
std::string tx_text; int tx_cursor=0;
static bool tx_live=false,tx_finishing=true,tx_done=true,tx_overflow=false;
static std::vector<float> tx_samples,tx_chunk;
static size_t tx_read=0;
static double tx_image_total=0,tx_fax_samples=0;
class WebMfsk : public mfsk {
public:
    using mfsk::mfsk;
    void prepare_image(int width,int height,bool gray,int spp){
        TXspp=spp;color=!gray;xmtbytes=width*height*(gray?1:3);rgb=col=row=pixelnbr=0;
        snprintf(picheader,sizeof(picheader),"\nSending Pic:%dx%d%s%s;",width,height,gray?"":"C",spp==8?"":spp==4?"p4":"p2");
        startpic=true;
    }
};
void web_tx_audio(const double* samples,int length){
    if(!samples||length<1||tx_done)return;
    // Some upstream modes generate an entire framed message in one call.
    if(tx_samples.size()+size_t(length)>size_t(1800)*active_modem->get_samplerate()) {tx_overflow=true;return;}
    for(int i=0;i<length;i++)tx_samples.push_back(std::isfinite(samples[i])?samples[i]:0);
}
std::unique_ptr<modem> decoder;
static int selected_mode = MODE_NULL;
std::string received,secondary,status1,status2,returned_text,returned_secondary;
static std::array<std::string,30> channel_text;
static std::array<int,30> channel_frequency{};
static double scope_phase=0,scope_quality=0;
static int scope_mode=Digiscope::BLANK,scope_serial=0,scope_video_serial=0;
static bool scope_highlight=false,scope_video_direction=false;
static double scope_axis=0;
static std::vector<double> scope_trace,scope_xy,scope_video;
static CharsetDistiller rx_charset,secondary_charset;
static std::array<CharsetDistiller,30> channel_charset;
static std::vector<unsigned char> raster,returned_raster;
static int raster_height=0;
static std::vector<uint32_t> image_updates,returned_image_updates;
static int image_width=0,image_height=0,image_serial=0;
void web_image_start(int w,int h){if(w<1||h<1||size_t(w)*h>16777216)return;image_width=w;image_height=h;image_serial++;image_updates.clear();}
void web_image_pixel(int value,int pixel){if(pixel<0||pixel>=image_width*image_height*3)return;image_updates.push_back(pixel);image_updates.push_back(clamp(value,0,255));}
void web_image_gray(int value,int byte_offset,int w){
    // fldigi's WEFAX pix_pos is an RGB byte offset, not a pixel index.
    if(byte_offset<0||w!=image_width||w<1||byte_offset%3!=0)return;
    const size_t pixel=size_t(byte_offset)/3;
    if(pixel>=size_t(w)*8192)return;
    if(pixel>=size_t(image_width)*image_height)image_height=int((pixel/size_t(w)/512+1)*512);
    for(int c=0;c<3;c++)web_image_pixel(value,byte_offset+c);
}
void put_rx_data(int* column,int height){raster_height=height;for(int i=0;i<height;i++)raster.push_back(clamp(column[i],0,255));}
void set_scope_mode(Digiscope::scope_mode mode){scope_mode=mode;scope_serial++;scope_phase=scope_quality=scope_axis=0;scope_highlight=false;scope_trace.clear();scope_xy.clear();scope_video.clear();}
void set_scope(double* data,int length,bool autoscale){
    if(!data){scope_trace.clear();return;}length=clamp(length,0,4096);scope_trace.assign(data,data+length);
    if(autoscale&&!scope_trace.empty()){auto bounds=std::minmax_element(scope_trace.begin(),scope_trace.end());double lo=*bounds.first,range=*bounds.second-lo;for(auto& value:scope_trace)value=range>0?(value-lo)/range:0;}
}
void set_scope_xaxis_1(double value){scope_axis=value;}
void set_phase(double phase,double quality,bool highlight){scope_phase=phase;scope_quality=quality;scope_highlight=highlight;}
void set_zdata(cmplx* data,int length){if(!data)return;scope_xy.clear();for(int i=0;i<clamp(length,0,1024);i++){scope_xy.push_back(data[i].real());scope_xy.push_back(data[i].imag());}}
void set_rtty(double lo,double hi,double amplitude){scope_trace={lo,hi,amplitude};}
void set_video(double* data,int length,bool direction){if(!data)return;length=clamp(length,0,4096);scope_video.assign(data,data+length);scope_video_direction=direction;scope_video_serial++;}
static void convert_char(CharsetDistiller& charset,std::string& target,unsigned int c){charset.rx(static_cast<unsigned char>(c));target+=charset.data();charset.clear();}
static void erase_utf8_character(std::string& text){if(text.empty())return;size_t start=text.size()-1;while(start>0&&(static_cast<unsigned char>(text[start])&0xc0)==0x80)start--;text.erase(start);}
void viewclearchannel(int ch){if(ch>=0&&ch<30){channel_text[ch].clear();channel_frequency[ch]=0;channel_charset[ch].reset();channel_charset[ch].clear();}}
void viewaddchr(int ch,int frequency,int c,trx_mode){
    if(ch<0||ch>=30)return;channel_frequency[ch]=frequency<4000?frequency:0;
    if(c==8||c>=32){std::string incoming;convert_char(channel_charset[ch],incoming,c);for(unsigned char byte:incoming){if(byte==8)erase_utf8_character(channel_text[ch]);else if(byte>=32)channel_text[ch]+=byte;}}
    if(channel_text[ch].size()>400){size_t start=channel_text[ch].size()-400;while(start<channel_text[ch].size()&&(static_cast<unsigned char>(channel_text[ch][start])&0xc0)==0x80)start++;channel_text[ch].erase(0,start);}
}
extern const char* web_family(int);
static std::array<double,8192> fft_ring{};
static std::array<cmplx,8192> fft_buffer{};
static std::array<float,4096> spectrum{};
static int fft_write=0,fft_count=0;
static g_fft<double> fft(8192);
void put_rx_char(unsigned int c,int){if(c==8||c==10||c==9||c>=32)convert_char(rx_charset,received,c);}
void put_echo_char(unsigned int){}
void put_sec_char(unsigned int c){if(c)convert_char(secondary_charset,secondary,c);}
void showDTMF(const std::string& text){received += "\n<DTMF> " + text;}
void put_MODEstatus(trx_mode){}
void put_Status1(const char* s,int,int){status1=s;}
void put_Status2(const char* s,int,int){status2=s;}
int get_tx_char(){
    if(tx_cursor<int(tx_text.size()))return static_cast<unsigned char>(tx_text[tx_cursor++]);
    // NAVTEX consumes a complete string until NODATA, rather than ETX.
    if(active_modem&&active_modem->get_mode()==MODE_NAVTEX)return GET_TX_CHAR_NODATA;
    if(active_modem&&active_modem->get_mode()==MODE_SITORB)return GET_TX_CHAR_NODATA;
    return tx_live&&!tx_finishing?GET_TX_CHAR_NODATA:GET_TX_CHAR_ETX;
}
double waterfall::powerDensity(double f,double width) const {
    const int low=int(f-width/2),high=int(f+width/2);if(low<0||high>4000||width<0)return 0;
    double sum=0;for(int i=low;i<=high;i++)sum+=powers[i];return sum/(width+1);
}
double waterfall::powerDensityMaximum(int count,const int (*bands)[2]) const {
    if(count<1)return carrier;std::vector<int> peaks(count,int(carrier));std::vector<double> energy(count,0);double total=0;
    for(int i=0;i<count;i++){double maximum=0;for(int hz=std::max(0,int(carrier+bands[i][0]));hz<std::min(4000,int(carrier+bands[i][1]));hz++){energy[i]+=powers[hz];if(powers[hz]>maximum){maximum=powers[hz];peaks[i]=hz;}}if(energy[i]==0)return carrier;total+=energy[i];}
    int mid=0;for(int i=0;i<count;i++)mid+=peaks[i]*energy[i]/total;return mid;
}
static void update_spectrum(const double* samples,int length){
    for(int i=0;i<length;i++){fft_ring[fft_write]=samples[i];fft_write=(fft_write+1)%8192;}
    fft_count+=length; if(fft_count<512)return; fft_count%=512;
    int rate=active_modem?active_modem->get_samplerate():8000;
    static std::array<double,8192> window{};static int window_type=-1;
    if(window_type!=progdefaults.wfPreFilter){window_type=progdefaults.wfPreFilter;switch(window_type){case 0:RectWindow(window.data(),8192);break;case 2:HammingWindow(window.data(),8192);break;case 3:HanningWindow(window.data(),8192);break;case 4:TriangularWindow(window.data(),8192);break;default:BlackmanWindow(window.data(),8192);}}
    const double scale=2.0/8192*std::sqrt(16.0/clamp(progdefaults.wf_latency,1,16));
    for(int i=0;i<8192;i++)fft_buffer[i]=fft_ring[(fft_write+i)%8192]*window[i]*scale;
    fft.ComplexFFT(fft_buffer.data());
    for(int i=0;i<4096;i++)spectrum[i]=10*log10(std::norm(fft_buffer[i])+1e-10);
    for(int hz=0;hz<8192;hz++){int bin=int(std::round(hz*8192.0/rate));wf->powers[hz]=hz>progdefaults.LowFreqCutoff&&bin<4096?std::norm(fft_buffer[bin]):0;}
}
extern "C" {
EMSCRIPTEN_KEEPALIVE int web_create(int mode){
    if(mode<0||mode>WEB_MODE_DTMF)return 0;
    std::string family=web_family(mode); if(family.empty())return 0;
    progdefaults.ifkp_enable_audit_log=false;progdefaults.ifkp_enable_heard_log=false;
    progdefaults.fsq_enable_audit_log=false;progdefaults.fsq_enable_heard_log=false;
    progdefaults.fsq_directed=false;
    decoder.reset(); active_modem=nullptr;
    selected_mode=mode;progdefaults.DTMFdecode=mode==WEB_MODE_DTMF;
    rx_charset.reset();rx_charset.clear();secondary_charset.reset();secondary_charset.clear();set_scope_mode(Digiscope::BLANK);
    raster.clear();returned_raster.clear();image_updates.clear();returned_image_updates.clear();image_width=image_height=0;
    if(family=="PSK")decoder=std::make_unique<psk>(mode);
    else if(family=="DominoEX")decoder=std::make_unique<dominoex>(mode);
    else if(family=="Throb")decoder=std::make_unique<throb>(mode);
    else if(family=="MT63")decoder=std::make_unique<mt63>(mode);
    else if(family=="Olivia")decoder=std::make_unique<olivia>(mode);
    else if(family=="Contestia")decoder=std::make_unique<contestia>(mode);
    else if(family=="RTTY")decoder=std::make_unique<rtty>(mode);
    else if(family=="CW")decoder=std::make_unique<cw>();
    else if(family=="MFSK")decoder=std::make_unique<WebMfsk>(mode);
    else if(family=="THOR")decoder=std::make_unique<thor>(mode);
    else if(family=="SCAMP")decoder=std::make_unique<scamp>(mode);
    else if(family=="IFKP")decoder=std::make_unique<ifkp>(mode);
    else if(family=="Hellschreiber")decoder=std::make_unique<feld>(mode);
    else if(family=="NAVTEX")decoder=std::make_unique<navtex>(mode);
    else if(family=="FSQ"){btn_SELCAL->value(1);decoder=std::make_unique<fsq>(mode);}
    else if(family=="WEFAX")decoder=std::make_unique<wefax>(mode);
    else if(family=="DTMF")decoder=std::make_unique<WebDtmf>();
    status1.clear(); status2.clear();
    active_modem=decoder.get(); progStatus.carrier=int(wf->carrier); active_modem->init();
    received.clear(); secondary.clear(); fft_ring.fill(0); fft_write=fft_count=0;for(int i=0;i<30;i++)viewclearchannel(i);return active_modem->get_samplerate();
}
EMSCRIPTEN_KEEPALIVE void web_reset(){if(active_modem){double tuned=modem::frequency;web_create(selected_mode);active_modem->set_freq(tuned);}received.clear();secondary.clear();}
EMSCRIPTEN_KEEPALIVE void web_process(const float* data,int length){if(!active_modem||length<1||length>65536)return;std::vector<double> pcm(length);for(int i=0;i<length;i++)pcm[i]=std::isfinite(data[i])?data[i]:0;update_spectrum(pcm.data(),length);active_modem->rx_process(pcm.data(),length);}
EMSCRIPTEN_KEEPALIVE void web_set_frequency(double f){if(active_modem)active_modem->set_freq(f);else wf->carrier=f;}
EMSCRIPTEN_KEEPALIVE void web_set_callsign(const char* callsign){progdefaults.myCall=callsign?std::string(callsign).substr(0,32):"";}
EMSCRIPTEN_KEEPALIVE void web_set_option(int key,double value){
    if(!std::isfinite(value))return;
    bool changed=false;auto assign=[&changed,value](auto& setting){using T=std::decay_t<decltype(setting)>;T next=static_cast<T>(value);changed=setting!=next;setting=next;};
    switch(key){
    case 0:assign(progStatus.afconoff);break;case 1:assign(progStatus.sqlonoff);break;
    case 2:assign(progStatus.sldrSquelchValue);break;
    case 3:wf->reversed=value;if(active_modem)active_modem->set_reverse(wf->Reverse());break;
    case 4:assign(progdefaults.rtty_shift);break;case 5:assign(progdefaults.rtty_baud);break;
    case 6:assign(progdefaults.rtty_bits);break;case 7:assign(progdefaults.rtty_parity);break;
    case 8:assign(progdefaults.rtty_stop);break;case 9:assign(progdefaults.rx_lowercase);break;
    case 10:assign(progStatus.VIEWER_psksquelch);break;case 11:if(active_modem)active_modem->clear_viewer();break;
    case 12:progdefaults.report_when_visible=true;progStatus.show_channels=value;break;
    case 13:assign(progdefaults.LowFreqCutoff);break;case 14:assign(progdefaults.HighFreqCutoff);break;
    case 15:assign(progdefaults.CWspeed);break;case 16:assign(progdefaults.CWbandwidth);break;
    case 17:assign(progdefaults.CWtrack);break;case 18:assign(progdefaults.CWmfilt);break;
    case 19:assign(progdefaults.CWrange);break;case 20:assign(progdefaults.CWlowerlimit);break;
    case 21:assign(progdefaults.CWupperlimit);break;case 22:assign(progdefaults.CW_fillen);break;
    case 23:assign(progdefaults.CWuseSOMdecoding);break;
    case 24:assign(progdefaults.hellagc);break;case 25:assign(progdefaults.HellRcvWidth);break;
    case 26:assign(progdefaults.HellRcvHeight);break;case 27:assign(progdefaults.HELL_BW);break;
    case 28:assign(progdefaults.HellBlackboard);break;case 29:assign(progdefaults.ifkp_baud);break;
    case 30:assign(progdefaults.ifkp_lowercase);break;
    case 31:if(!active_modem||active_modem->get_mode()==MODE_OLIVIA)assign(progdefaults.oliviabw);break;case 32:if(!active_modem||active_modem->get_mode()==MODE_OLIVIA)assign(progdefaults.oliviatones);break;
    case 33:assign(progdefaults.oliviasinteg);break;case 34:assign(progdefaults.oliviasmargin);break;
    case 35:if(!active_modem||active_modem->get_mode()==MODE_CONTESTIA)assign(progdefaults.contestiabw);break;case 36:if(!active_modem||active_modem->get_mode()==MODE_CONTESTIA)assign(progdefaults.contestiatones);break;
    case 37:assign(progdefaults.contestiasinteg);break;case 38:assign(progdefaults.contestiasmargin);break;
    case 39:assign(progdefaults.wefax_lpm_576);progdefaults.wefax_lpm_288=progdefaults.wefax_lpm_576;if(auto fax=dynamic_cast<wefax*>(active_modem))fax->set_lpm();break;
    case 40:if(auto fax=dynamic_cast<wefax*>(active_modem))fax->skip_apt();break;
    case 41:if(auto fax=dynamic_cast<wefax*>(active_modem))fax->skip_phasing(false);break;
    case 42:if(auto fax=dynamic_cast<wefax*>(active_modem))fax->end_reception();break;
    case 43:assign(progdefaults.fsqbaud);break;
    case 44:wf->usb=value!=0;if(active_modem)active_modem->set_reverse(wf->Reverse());break;
    case 45:assign(progdefaults.rtty_afcspeed);break;case 46:assign(progdefaults.rtty_custom_shift);break;
    case 47:assign(progdefaults.mt63_rx_integration);break;case 48:assign(progdefaults.mt63_8bit);break;
    case 49:assign(progdefaults.DOMINOEX_FEC);break;case 50:assign(progdefaults.DOMINOEX_FILTER);break;case 51:assign(progdefaults.DOMINOEX_BW);break;
    case 52:assign(progdefaults.SearchRange);break;case 53:assign(progdefaults.fsq_movavg);break;case 54:assign(progdefaults.fsqhits);break;case 55:assign(progdefaults.fsq_lowercase);break;
    case 56:assign(progdefaults.wfPreFilter);break;case 57:assign(progdefaults.wf_latency);break;
    case 58:if(auto* dtmf=dynamic_cast<WebDtmf*>(decoder.get()))dtmf->tone_ms=int(clamp(value,40.0,2000.0));break;
    case 59:if(auto* dtmf=dynamic_cast<WebDtmf*>(decoder.get()))dtmf->gap_ms=int(clamp(value,30.0,2000.0));break;
    }
    if(changed&&active_modem){if(key>=4&&key<=8&&active_modem->get_mode()==MODE_RTTY)active_modem->restart();if(key>=15&&key<=23&&active_modem->get_mode()==MODE_CW){active_modem->sync_parameters();active_modem->reset_rx_filter();}if(key>=24&&key<=28&&std::string(web_family(active_modem->get_mode()))=="Hellschreiber")active_modem->restart();if(key==29&&active_modem->get_mode()==MODE_IFKP)active_modem->restart();if(key>=31&&key<=34)if(auto modem=dynamic_cast<olivia*>(active_modem))modem->restart();if(key>=35&&key<=38)if(auto modem=dynamic_cast<contestia*>(active_modem))modem->restart();if(key==43&&active_modem->get_mode()==MODE_FSQ)active_modem->restart();}
    if(changed&&active_modem){if(key==46&&active_modem->get_mode()==MODE_RTTY)active_modem->restart();if(key==50||key==51)if(auto modem=dynamic_cast<dominoex*>(active_modem))modem->restart();if(key>=53&&key<=55&&active_modem->get_mode()==MODE_FSQ)active_modem->restart();}
}
EMSCRIPTEN_KEEPALIVE void web_flush(){if(active_modem)active_modem->rx_flush();rx_charset.flush();received+=rx_charset.data();rx_charset.clear();secondary_charset.flush();secondary+=secondary_charset.data();secondary_charset.clear();}
// An encoder uses a separate WASM instance from the browser receiver.
EMSCRIPTEN_KEEPALIVE int web_tx_supported(int mode){return mode>=0&&mode<=WEB_MODE_DTMF&&std::string(web_family(mode))!=""&&std::string(web_family(mode))!="WEFAX";}
EMSCRIPTEN_KEEPALIVE int web_tx_image_supported(int mode){
    if(mode<0||mode>=NUM_MODES)return 0;
    const std::string family=web_family(mode);
    return family=="WEFAX"||family=="MFSK"||family=="THOR"||family=="IFKP"||family=="FSQ";
}
static int begin_tx(const char* text,int live,double offset){
    if(!active_modem||!text||!std::isfinite(offset))return 0;
    tx_text=text;tx_cursor=0;tx_live=live;tx_finishing=!live;tx_done=false;tx_overflow=false;
    tx_read=0;tx_samples.clear();tx_chunk.clear();modem::tx_sample_count=0;
    fft_ring.fill(0);fft_write=fft_count=0;spectrum.fill(-100);
    progdefaults.TxOffset=clamp(offset,-500.0,500.0);trx_state=STATE_TX;
    active_modem->set_stopflag(false);active_modem->tx_init();return active_modem->get_samplerate();
}
EMSCRIPTEN_KEEPALIVE int web_tx_begin(const char* text,int live,double offset){
    if(!web_tx_supported(selected_mode))return 0;
    return begin_tx(text,live,offset);
}
EMSCRIPTEN_KEEPALIVE int web_tx_image_begin(const unsigned char* pixels,int width,int height,int gray,int format,int spp,int live,double offset,const char* callsign){
    if(!active_modem||!web_tx_image_supported(selected_mode)||!pixels||width<1||height<1||width>4095||height>4095||size_t(width)*height>8000000)return 0;
    const std::string family=web_family(selected_mode);
    static const int widths[]={59,120,240,160,320,640},heights[]={74,150,300,120,240,480};
    static const int fsq_widths[]={160,320,640,640,240,240,120,120},fsq_heights[]={120,240,480,480,300,300,150,150};
    static const char colors[]={'T','M','P','S','L','V'},grays[]={'t','m','p','s','l','F'},fsq_types[]={'S','L','F','V','P','p','M','m'};
    if((family=="THOR"||family=="IFKP")&&(format<0||format>5||width!=widths[format]||height!=heights[format]))return 0;
    if(family=="FSQ"&&(format<0||format>7||width!=fsq_widths[format]||height!=fsq_heights[format]||bool(gray)!=(format==2||format==5||format==7)||!callsign||!callsign[0]))return 0;
    if(family=="WEFAX"&&(format<0||format>3||!gray||width!=(selected_mode==MODE_WEFAX_576?1809:904)))return 0;
    if(family=="MFSK"&&spp!=2&&spp!=4&&spp!=8)return 0;
    web_tx_pixels.assign(pixels,pixels+size_t(width)*height*3);
    tx_image_total=width*height*(gray?1:3);
    tx_fax_samples=family=="WEFAX"?11025*20+int(11025*60.0/all_lpm_values[format].m_value)*(height+21):0;
    web_image_position=0;web_image_done=false;image_widget.show();image_choice.value(format);
    if(family=="FSQ"){progdefaults.myCall=callsign;progdefaults.fsq_directed=true;}
    if(family=="WEFAX"){progdefaults.wefax_lpm_576=progdefaults.wefax_lpm_288=format;}
    // WEFAX uses the upstream fixed 1900 Hz carrier and absolute APT tones.
    const int rate=begin_tx("",live,family=="WEFAX"?0:offset);
    if(!rate)return 0;
    // Image jobs are finite, even when their PCM is played in realtime.
    tx_finishing=true;
    if(family=="MFSK"){
        dynamic_cast<WebMfsk*>(active_modem)->prepare_image(width,height,gray,spp);
        std::vector<unsigned char> ordered(width*height*(gray?1:3));
        for(int y=0;y<height;y++)for(int x=0;x<width;x++){
            const int p=(y*width+x)*3;
            if(gray)ordered[y*width+x]=(31*web_tx_pixels[p]+61*web_tx_pixels[p+1]+8*web_tx_pixels[p+2])/100;
            else for(int c=0;c<3;c++)ordered[(y*3+c)*width+x]=web_tx_pixels[p+c];
        }
        web_tx_pixels.swap(ordered);xmtpicbuff=web_tx_pixels.data();
    }else if(family=="THOR"){
        thorpicTxWin=&image_widget;dynamic_cast<thor*>(active_modem)->thor_send_image(std::string(" pic%")+(gray?grays[format]:colors[format]),gray);
    }else if(family=="IFKP"){
        ifkppicTxWin=&image_widget;dynamic_cast<ifkp*>(active_modem)->ifkp_send_image(std::string(" pic%")+(gray?grays[format]:colors[format]),gray);
    }else if(family=="FSQ"){
        fsqpicTxWin=&image_widget;active_modem->fsq_tx_image=true;tx_text=std::string("allcall% ")+fsq_types[format];
    }else{
        for(size_t p=0;p<web_tx_pixels.size();p+=3){unsigned char v=(31*web_tx_pixels[p]+61*web_tx_pixels[p+1]+8*web_tx_pixels[p+2])/100;web_tx_pixels[p]=web_tx_pixels[p+1]=web_tx_pixels[p+2]=v;}
        dynamic_cast<wefax*>(active_modem)->set_tx_parameters(all_lpm_values[format].m_value,web_tx_pixels.data(),false,width,height);
    }
    return rate;
}
EMSCRIPTEN_KEEPALIVE int web_tx_append(const char* text){if(tx_done||tx_finishing||!text)return 0;tx_text+=text;return 1;}
EMSCRIPTEN_KEEPALIVE void web_tx_finish(){tx_finishing=true;}
EMSCRIPTEN_KEEPALIVE int web_tx_step(int maximum){
    tx_chunk.clear();maximum=clamp(maximum,1,8192);
    if(tx_overflow)return -1;
    if(tx_read>=tx_samples.size()){
        tx_read=0;tx_samples.clear();
        if(tx_done)return 0;
        int result=active_modem->tx_process();
        if(result<0){tx_done=true;trx_state=STATE_RX;}
        if(tx_overflow)return -1;
        // CW waits silently when its live text queue is empty. Yield silence
        // to the audio clock instead of spinning the browser worker.
        if(!tx_done&&tx_samples.empty())tx_samples.resize(std::min(maximum,512),0);
    }
    size_t length=std::min(size_t(maximum),tx_samples.size()-tx_read);
    tx_chunk.assign(tx_samples.begin()+tx_read,tx_samples.begin()+tx_read+length);tx_read+=length;
    // Mirror desktop trx_xmit_wfall_queue without invoking the receive modem.
    if(tx_live&&length){std::vector<double> pcm(tx_chunk.begin(),tx_chunk.end());update_spectrum(pcm.data(),int(length));}
    return int(length);
}
EMSCRIPTEN_KEEPALIVE const float* web_tx_buffer(){return tx_chunk.data();}
EMSCRIPTEN_KEEPALIVE int web_tx_done(){return tx_done&&tx_read>=tx_samples.size();}
EMSCRIPTEN_KEEPALIVE int web_tx_ended(){return tx_done;}
EMSCRIPTEN_KEEPALIVE int web_tx_cursor(){return tx_cursor;}
EMSCRIPTEN_KEEPALIVE double web_tx_image_progress(){
    if(tx_done)return 100;
    return tx_fax_samples?100.0*modem::tx_sample_count/tx_fax_samples:tx_image_total?100.0*web_image_position/tx_image_total:0;
}
EMSCRIPTEN_KEEPALIVE double web_tx_frequency(){return active_modem?active_modem->get_txfreq_woffset():1500;}
EMSCRIPTEN_KEEPALIVE const char* web_scope(){
    static std::string json;std::ostringstream out;out<<"{\"mode\":"<<scope_mode<<",\"serial\":"<<scope_serial<<",\"phase\":"<<scope_phase<<",\"quality\":"<<scope_quality<<",\"highlight\":"<<(scope_highlight?"true":"false")<<",\"axis\":"<<scope_axis<<",\"videoSerial\":"<<scope_video_serial<<",\"videoDirection\":"<<(scope_video_direction?"true":"false");
    auto array=[&out](const char* name,const std::vector<double>& values){out<<",\""<<name<<"\":[";for(size_t i=0;i<values.size();i++){if(i)out<<',';out<<(std::isfinite(values[i])?values[i]:0);}out<<']';};array("trace",scope_trace);array("xy",scope_xy);array("video",scope_video);out<<'}';json=out.str();return json.c_str();
}
EMSCRIPTEN_KEEPALIVE int web_sample_rate(){return active_modem?active_modem->get_samplerate():8000;}
EMSCRIPTEN_KEEPALIVE double web_frequency(){return modem::frequency;}
EMSCRIPTEN_KEEPALIVE double web_metric(){return active_modem?active_modem->get_metric():0;}
EMSCRIPTEN_KEEPALIVE double web_bandwidth(){return active_modem?active_modem->get_bandwidth():31.25;}
EMSCRIPTEN_KEEPALIVE const char* web_waterfall_geometry(){
    if(selected_mode==WEB_MODE_DTMF)return "{\"bands\":[],\"tracks\":[],\"hover\":[],\"markerEdges\":[]}";
    // Adapt the original WFdisp::makeMarker_, makeMarker, and color waterfall
    // track/cursor rules. Return audio-Hz offsets; the browser scales them.
    // Keep the upstream modem bandwidth and RTTY filter width authoritative.
    const int mode=active_modem?active_modem->get_mode():MODE_PSK31;
    const int bandwidth=int(web_bandwidth());
    int marker_width=bandwidth;
    if(mode>=MODE_PSK_FIRST&&mode<=MODE_PSK_LAST)marker_width+=progdefaults.SearchRange;
    else if(mode>=MODE_FELDHELL&&mode<=MODE_HELL80)marker_width=int(progdefaults.HELL_BW);
    marker_width=int(marker_width/2.0+1);
    int marker_hi=marker_width, track_lo=bandwidth/2, track_hi=bandwidth/2;
    int hover_hi=bandwidth/2;
    if(mode>=MODE_MT63_500S&&mode<=MODE_MT63_2000L){marker_hi=marker_width*31/32;track_hi=track_hi*31/32;hover_hi=hover_hi*31/32;}
    if(mode==MODE_FSQ||mode==MODE_IFKP){marker_hi=marker_width*32/33;track_lo=track_hi=69*bandwidth/100;hover_hi=hover_hi*32/33;}
    std::ostringstream out;
    out<<"{\"bands\":[";
    if(mode==MODE_RTTY){
        const int shift=int(progdefaults.rtty_shift<rtty::numshifts?rtty::SHIFT[progdefaults.rtty_shift]:progdefaults.rtty_custom_shift);
        const int hi=int((shift+progdefaults.RTTY_BW)/2.0),lo=int((shift-progdefaults.RTTY_BW)/2.0);
        out<<"["<<-hi<<","<<-lo<<"],["<<lo<<","<<hi<<"]";
    }else out<<"["<<-marker_width<<","<<marker_hi<<"]";
    out<<"],\"tracks\":["<<-track_lo<<","<<track_hi<<"],\"hover\":["<<-bandwidth/2<<","<<hover_hi
       <<"],\"markerEdges\":["<<-marker_width<<","<<marker_hi<<"]}";
    static std::string json;json=out.str();return json.c_str();
}
EMSCRIPTEN_KEEPALIVE const char* web_modes(){static std::string json; if(json.empty()){json="[";bool first=true;for(int i=1;i<NUM_MODES;i++){if(!first)json+=",";first=false;json+="{\"id\":"+std::to_string(i)+",\"name\":\""+mode_info[i].sname+"\",\"label\":\""+mode_info[i].name+"\",\"family\":\""+web_family(i)+"\",\"enabled\":"+(std::string(web_family(i)).empty()?"false":"true")+"}";}json+=",{\"id\":"+std::to_string(WEB_MODE_DTMF)+",\"name\":\"DTMF\",\"label\":\"DTMF\",\"family\":\"DTMF\",\"enabled\":true}]";}return json.c_str();}
EMSCRIPTEN_KEEPALIVE const char* web_take_text(){returned_text.swap(received);received.clear();return returned_text.c_str();}
EMSCRIPTEN_KEEPALIVE const char* web_take_secondary(){returned_secondary.swap(secondary);secondary.clear();return returned_secondary.c_str();}
EMSCRIPTEN_KEEPALIVE const char* web_status1(){return status1.c_str();}
EMSCRIPTEN_KEEPALIVE const char* web_status2(){return status2.c_str();}
EMSCRIPTEN_KEEPALIVE const float* web_spectrum(){return spectrum.data();}
EMSCRIPTEN_KEEPALIVE int web_spectrum_size(){return spectrum.size();}
EMSCRIPTEN_KEEPALIVE double web_phase(){return scope_phase;}
EMSCRIPTEN_KEEPALIVE double web_phase_quality(){return scope_quality;}
EMSCRIPTEN_KEEPALIVE const char* web_channels(){static std::string json;json="[";for(int i=0;i<30;i++){if(i)json+=",";json+="{\"frequency\":"+std::to_string(channel_frequency[i])+",\"text\":\"";for(char c:channel_text[i]){if(c=='"'||c=='\\')json+='\\';json+=c;}json+="\"}";}json+="]";return json.c_str();}
EMSCRIPTEN_KEEPALIVE const unsigned char* web_take_raster(){returned_raster.swap(raster);raster.clear();return returned_raster.data();}
EMSCRIPTEN_KEEPALIVE int web_raster_size(){return returned_raster.size();}
EMSCRIPTEN_KEEPALIVE int web_raster_height(){return raster_height;}
EMSCRIPTEN_KEEPALIVE const uint32_t* web_take_image_updates(){returned_image_updates.swap(image_updates);image_updates.clear();return returned_image_updates.data();}
EMSCRIPTEN_KEEPALIVE int web_image_updates_size(){return returned_image_updates.size();}
EMSCRIPTEN_KEEPALIVE int web_image_width(){return image_width;}
EMSCRIPTEN_KEEPALIVE int web_image_height(){return image_height;}
EMSCRIPTEN_KEEPALIVE int web_image_serial(){return image_serial;}
}
