#pragma once
// Browser adapters for native UI and device interfaces. Decoder math remains upstream.
#include <algorithm>
#include <array>
#include <cctype>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <iosfwd>
#include <fstream>
#include <string>
#include <vector>
#include <sys/time.h>
#include <pthread.h>
#include "globals.h"
#include "complex.h"
#include "misc.h"
#include "gfft.h"
#include "re.h"

#define REQ(...) ((void)0)
#define REQ_FLUSH(...) ((void)0)
#define ENSURE_THREAD(...) ((void)0)
#define LOG_DEBUG(...) ((void)0)
#define LOG_INFO(...) ((void)0)
#define LOG_ERROR(...) ((void)0)
#define LOG_WARN(...) ((void)0)
#define LOG_VERBOSE(...) ((void)0)
#define LOG_PERROR(...) ((void)0)
#define LOG_FILE_SOURCE(...)
#define PACKAGE_VERSION "4.2.13"
#define PKGDATADIR ""
#define SCBLOCKSIZE 512
#define IMAGE_WIDTH 4096
#define _(x) (x)
#ifndef likely
#define likely(x) __builtin_expect(!!(x),1)
#define unlikely(x) __builtin_expect(!!(x),0)
#endif
#define CLAMP(x,a,b) std::min(std::max((x),static_cast<decltype(x)>(a)),static_cast<decltype(x)>(b))
constexpr int STATUS_DIM = 0, STATUS_CLEAR = 1, GET_TX_CHAR_ETX = 3, GET_TX_CHAR_NODATA = -1, EOT=4;
constexpr double TONE_AMP = 0.8;
// Browser-only mode; leave the original trx_mode enum/table unchanged.
constexpr int WEB_MODE_DTMF = NUM_MODES;
struct FTextBase { enum { RECV, XMIT, CTRL, ALTR, FSQ_UND, FSQ_DIR, FSQ_TX }; };
struct Digiscope { enum scope_mode { SCOPE, PHASE, PHASE1, PHASE2, PHASE3, RTTY, XHAIRS, WWV, DOMDATA, DOMWF, BLANK }; };
class SoundBase {};
class PLOT_XY {};
#include "morse.h"
struct Widget {
    double number=0; bool shown=false;
    double value() const { return number; } void value(double v) { number=v; } bool visible() const { return shown; }
    void show() { shown=true; } void hide() { shown=false; } void redraw() {} void activate() {} void deactivate() {}
};
extern Widget *dlgViewer, *test_signal_window, *btn_imd_on, *xmtimd;
inline Widget hell_widget,*sldrHellBW=&hell_widget,*btnOffsetOn=&hell_widget,*ctrl_freq_offset=&hell_widget,*btn_SELCAL=&hell_widget;
struct notify_dialog {template<class...T> void notify(T...){} void show(){} template<class...T> void message(T...){} };
using Fl_Widget=Widget; using Fl_Button=Widget; using Fl_Double_Window=Widget; using Fl_Group=Widget;
struct Fl_Shared_Image {static Fl_Shared_Image* get(const char*,int,int){return nullptr;} const char** data(){return nullptr;} int d(){return 3;}};
struct picture : Widget {void save_png(const char*){}};
struct view_cw {void restart(){} void rx_process(const double*,int){} void clear(){}};
struct view_scamp {void restart(){} void rx_process(const double*,int){} void clear(){} void clearch(int){}};
void put_rx_data(int*,int);
void web_image_start(int,int);
void web_image_pixel(int,int);
void web_image_gray(int,int,int);
enum {NOTES,CALL,NAME,TX_PWR,ADIF_MODE};
struct cQsoRec {void clear(){} void setFrequency(double){} void setDateTime(bool){} template<class...T> void putField(T...){} };
inline constexpr bool use_nanoIO=false;
inline bool CW_KEYLINE_isopen=false;
inline void set_nanoCW(){} inline void set_nanoWPM(int){} inline void set_nano_dash2dot(double){}
inline void put_cwRcvWPM(double){} inline void set_CWwpm(){} inline void set_CW_FLTK(){}
inline void start_cwio_thread(){} inline void stop_cwio_thread(){}
inline void flrig_cwio_send(int){} inline bool WK_send_char(int){return false;}
inline void KYkeyer_send_char(int){} inline void ICOMkeyer_send_char(int){} inline void FTkeyer_send_char(int){}
extern bool mailserver, mailclient, bHistory, bHighSpeed;
extern class modem* active_modem;
extern std::string tx_text;
extern int tx_cursor;
void web_tx_audio(const double*, int);
int get_tx_char();
void put_rx_char(unsigned int, int style = FTextBase::RECV);
void put_echo_char(unsigned int);
inline void put_echo_char(unsigned int c,int){put_echo_char(c);}
void put_sec_char(unsigned int);
void showDTMF(const std::string&);
void put_MODEstatus(trx_mode);
inline void put_MODEstatus(const char*){}
inline void put_MODEstatus(std::string){}
template<class...T> inline void put_MODEstatus(const char*,T...){}
void put_Status1(const char*, int = 0, int = 0);
void put_Status2(const char*, int = 0, int = 0);
inline void put_status(const char*, int = 0) {}
inline void display_fsq_rx_text(const std::string&,int){}
inline void display_fsq_mon_text(const std::string& s,int style){if(style==FTextBase::RECV)for(unsigned char c:s)put_rx_char(c);}
inline std::string heard_list(){return "";}
inline void write_fsq_que(const std::string&){} inline void fsq_xmt(std::string){} inline void clear_xmt_arrays(){}
inline int fl_utf8froma(char* dst,int length,const char* src,int count){int n=std::min(length,count);std::memcpy(dst,src,n);dst[n]=0;return n;}
void set_scope_mode(Digiscope::scope_mode);
void set_scope(double*,int,bool = true);
void set_scope_xaxis_1(double);
void set_phase(double,double,bool);
void set_rtty(double,double,double);
template<class... T> inline void set_xy(T...) {}
void set_zdata(cmplx*,int);
void set_video(double*,int,bool = false);
template<class... T> inline void set_freq_display(T...) {}
template<class... T> inline void set_bandwidth(T...) {}
template<class... T> inline void set_s2n(T...) {}
template<class... T> inline void set_quality(T...) {}
inline void MilliSleep(long) {}
struct guard_lock { explicit guard_lock(pthread_mutex_t*) {} };
struct syncobj {pthread_mutex_t lock=PTHREAD_MUTEX_INITIALIZER;pthread_mutex_t* mtxp(){return &lock;}void signal(){} bool wait(int){return false;}};
struct Fl { static void awake() {} };
constexpr int WF_FFTLEN = 8192, WF_SAMPLERATE = 8000, WF_BLOCKSIZE = 512;
class waterfall {
public:
    double carrier = 1500; bool reversed = false; bool usb = true;
    std::array<double,WF_FFTLEN> powers{};
    double Carrier() const { return carrier; } bool Reverse() const { return reversed; } bool USB() const { return usb; }
    unsigned long long rfcarrier()const{return 14070100;}
    double Pwr(int hz) const { return hz>=0 && hz<WF_FFTLEN ? powers[hz] : 0; }
    double powerDensity(double frequency, double width) const;
    double powerDensityMaximum(int,const int (*)[2]) const;
    void redraw_marker() {} void setCarrier(double f) { carrier=f; }
};
extern waterfall *wf;
void viewaddchr(int,int,int,trx_mode);
void viewclearchannel(int);
struct view_rtty {
    view_rtty() {} template<class...T> view_rtty(T...) {} template<class...T> void restart(T...) {}
    void rx_process(const double*,int) {} void clear() {} void clearch(int) {} int get_freq(int) {return 0;}
};
struct Cserial {};
extern Cserial rigio;
struct FSK {
    template<class...T> void send(T...) {} template<class...T> void append(T...) {}
    template<class...T> void fsk_shares_port(T...) {} template<class...T> void open_port(T...) {}
    void shift_on_space(bool) {} void reverse(bool) {} void dtr(bool) {} void rts(bool) {}
    bool sending(){return false;} void abort() {} bool open(){return false;} bool close(){return true;}
};
inline int nano_sleep(timespec*,timespec*){return 0;}
inline void flrig_fskio_send_text(std::string){}
inline void nano_send_char(int){}
inline void WKFSK_send_char(int){}
inline void Nav_send_char(int){}
inline void start_deadman(){} inline void stop_deadman(){}
inline void flrig_get_idles(){} inline void flrig_get_stopbits(){} inline void flrig_get_baud(){}
constexpr bool use_Nav=false;
inline state_t trx_state=STATE_RX;
inline void start_tx(){}
inline std::string TempDir;
inline const char* zdate(){return "";} inline const char* ztime(){return "";}
inline const char* zshowtime(){return "";}
inline const char* fl_filename_name(const char* path){auto p=std::strrchr(path,'/');return p?p+1:path;}
struct synop_callback { virtual ~synop_callback(){}; virtual void print(const char*,size_t,bool) const {} virtual void log(const char*,size_t) const {} };
struct synop {
    static synop* instance(){ static synop s; return &s; } bool enabled(){return false;}
    template<class T> static void setup(){} void init(){}
    template<class...T> void set_callback(T...) {} template<class...T> void flush(T...) {}
    template<class...T> void add(T...) {} template<class...T> void decode(T...) {}
};
struct SynopDB { static void Init(const char*){} };
#include "web_configuration.h"
#include "web_status.h"
