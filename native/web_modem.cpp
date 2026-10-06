#include "modem.h"
int parity(unsigned long value){return __builtin_parityl(value);}

double modem::frequency=1500, modem::tx_frequency=1500;
bool modem::freqlock=false, modem::XMLRPC_CPS_TEST=false;
unsigned long modem::tx_sample_count=0;
unsigned int modem::tx_sample_rate=8000;
modem::modem() : morse(new cMorse), mode(MODE_NULL), scard(nullptr), stopflag(false), fragmentsize(512), samplerate(8000), reverse(false), sigsearch(0), sig_start(false), sig_stop(false), sig_smpl(0), symlen(1), bandwidth(31.25), freqerr(0), rx_corr(0), tx_corr(0), PTTphaseacc(0), cwTrack(false), cwLock(false), cwRcvWPM(18), cwXmtWPM(18), squelch(0), metric(0), syncpos(0), backspaces(0), txstr(nullptr), txptr(nullptr), historyON(false), scopemode(Digiscope::PHASE), scptr(0), s2n_ncount(0), s2n_sum(0), s2n_sum2(0), s2n_metric(0), s2n_valid(false), cap(CAP_RX), play_audio(false), CW_EOT(false) { frequency=tx_frequency=wf->Carrier();std::fill(std::begin(quality),std::end(quality),0); }
void modem::init(){ stopflag=false; metric=0; reverse=wf->Reverse() ^ !wf->USB(); }
void modem::set_freq(double f){
    const double low=progdefaults.LowFreqCutoff+bandwidth/2, high=progdefaults.HighFreqCutoff-bandwidth/2;
    frequency=low<=high?clamp(f,low,high):(progdefaults.LowFreqCutoff+progdefaults.HighFreqCutoff)/2;
    if(!freqlock)tx_frequency=frequency;wf->carrier=frequency;
}
void modem::set_freqlock(bool on){freqlock=on;}
void modem::init_freqlock(){freqlock=false;}
void modem::set_reverse(bool on){reverse=on ^ !wf->USB();}
void modem::set_bandwidth(double bw){bandwidth=bw;}
void modem::set_samplerate(int rate){samplerate=rate;}
void modem::set_metric(double m){metric=m;}
void modem::display_metric(double m){metric=m;}
double modem::get_txfreq() const {return mode==MODE_FSQ?1500:tx_frequency;}
double modem::get_txfreq_woffset() const {return get_txfreq()-progdefaults.TxOffset;}
int modem::tx_process(){return -1;}
void modem::videoText(){}
void modem::s2nreport(){}
void modem::pretone(){}
void modem::init_queues(){}
#include "web_modem_transmit.h"
void modem::ModulateStereo(double* samples,double*,int length,bool){ModulateXmtr(samples,length);}
void modem::ModulateVideo(double* samples,int length){ModulateXmtr(samples,length);}
void modem::ModulateVideoStereo(double* samples,double*,int length,bool){ModulateXmtr(samples,length);}
#include "web_modem_quality.h"
