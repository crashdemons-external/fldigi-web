#pragma once
#include "mfsk.h"
// Browser pixel storage replaces only the desktop picture widgets.
inline Widget image_widget;
inline std::vector<unsigned char> web_tx_pixels;
inline int web_image_position=0;
inline bool web_image_done=true;
inline double web_tx_pixel(int pixel,int channel){size_t i=size_t(pixel)*3+channel;return i<web_tx_pixels.size()?web_tx_pixels[i]:0;}
inline Fl_Double_Window *picRxWin=nullptr, *picTxWin=nullptr, *thorpicTxWin=nullptr;
inline Fl_Button *btnpicTxSendAbort=&image_widget,*btnpicTxSPP=&image_widget,*btnpicTxSendColor=&image_widget,*btnpicTxSendGrey=&image_widget,*btnpicTxLoad=&image_widget,*btnpicTxClose=&image_widget;
struct ImageChoice {int selected=0;int value(){return selected;}void value(int v){selected=v;}};
inline ImageChoice image_choice,*selthorpicSize=&image_choice;
inline Fl_Shared_Image* my_avatar_img=nullptr;
inline picture image_picture;
inline picture *picRx=&image_picture;
inline unsigned char *xmtpicbuff=nullptr;
inline std::string autosave_dir, imageheader, avatarheader, AvatarDir, PicsDir;
inline int txSPP=8;
inline unsigned char avatar[59*74*3]{};
inline int print_time_left(float,char* text,size_t length,const char*,int){if(length)text[0]=0;return 0;}
inline void setpicture_link(mfsk*){}
inline void activate_mfsk_image_item(bool){} inline void activate_thor_image_item(bool){}
inline int load_image(const char*){return 0;}
inline void pic_TxSendColor(){} inline void pic_TxSendGrey(){}
inline double thorpic_TxGetPixel(int p,int c){return web_tx_pixel(p,c);}
inline double thor_get_avatar_pixel(int,int){return 0;}
inline void createTxViewer(){picTxWin=&image_widget;}
inline void createRxViewer(){picRxWin=&image_widget;}
inline void activate_ifkp_image_item(bool){} inline void ifkp_deleteTxViewer(){} inline void ifkp_deleteRxViewer(){}
inline ImageChoice *selifkppicSize=&image_choice;
inline Widget *ifkppicTxWin=nullptr;
inline double ifkp_get_avatar_pixel(int,int){return 0;}
inline double ifkppic_TxGetPixel(int p,int c){return web_tx_pixel(p,c);}
inline Widget *fsqpicTxWin=nullptr;
inline ImageChoice *selfsqpicSize=&image_choice;
inline double fsqpic_TxGetPixel(int p,int c){return web_tx_pixel(p,c);}
inline void showRxViewer(int w,int h){web_image_start(w,h);}
inline void updateRxPic(int value,int pixel){web_image_pixel(value,pixel);}
inline void image_dimensions(char type){int w=640,h=480;switch(type){case 'A':case 'T':case 't':w=59;h=74;break;case 'S':case 's':w=160;h=120;break;case 'L':case 'l':w=320;h=240;break;case 'P':case 'p':w=240;h=300;break;case 'M':case 'm':w=120;h=150;break;}web_image_start(w,h);}
inline void thor_showRxViewer(char c){image_dimensions(c);} inline void ifkp_showRxViewer(char c){image_dimensions(c);}
inline void thor_clear_avatar(){web_image_start(59,74);} inline void ifkp_clear_avatar(){web_image_start(59,74);}
inline void thor_updateRxPic(int v,int p){web_image_pixel(v,p);} inline void thor_update_avatar(int v,int p){web_image_pixel(v,p);}
inline void ifkp_updateRxPic(int v,int p){web_image_pixel(v,p);} inline void ifkp_update_avatar(int v,int p){web_image_pixel(v,p);}
inline void fsq_showRxViewer(int w,int h,char){web_image_start(w,h);} inline void fsq_updateRxPic(int v,int p){web_image_pixel(v,p);}
