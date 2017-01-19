---
title: 史上最详细Android集成QQ，微信，微博分享（不用第三方）持续更新中
date: 2016-04-13 18:52:37
categories: Android
tags:
  - Android
  - QQ登录分享
  - 微信登录分享
  - 微博登录分享
---
[TOC]


现在项目中用个第三方登录，或分享已经不是什么稀奇事了，但是要想把这个功能做好，那可就不容易了。估计到这里就有人会说了，扯犊子，这玩意，我用第三方sdk，什么umeng，sharesdk分分钟给你做出来，可是这些第三方sdk只有对项目的分享要求不高的时候才适合，如果要定制分享，那我就只能呵呵。虽然第三方登录或分享没什么技术难度，但是各种配置，而且每一个都不太一样，少配置一个地方代码就通不过了，所以基于上问题，特写此文以备不时之需。

好，上面扯太多了，现在正式上代码，我们先从QQ入手，你问为什么，因为他最简单呀

## QQ

### 下载sdk并运行demo


首先不得不吐槽一个问题，就是腾讯的文档是最全的，全的你都找不到在哪里，[点击这里可以查看官方文档](http://wiki.open.qq.com/wiki/%E5%88%9B%E5%BB%BA%E5%B9%B6%E9%85%8D%E7%BD%AE%E5%B7%A5%E7%A8%8B)这里下载官方[demo](http://download.csdn.net/detail/renpingqing/9485271)下载

另外，由于官方文档太难找了，特上此图

![这里写图片描述](http://img.blog.csdn.net/20160408115419797)

首先下载sdk,我下载的版本是Android_SDK_V2.9.4，解压后目录如图所示

![这里写图片描述](http://img.blog.csdn.net/20160408120313571)

其他jar目录下面是需要添加你的项目依赖中去的jar包，sample就是顾名思义啦，可以直接将他导入eclipse，并更编码为utf-8，不过当前版本的demo配置有点问题，导入完成后会有如下错误

![这里写图片描述](http://img.blog.csdn.net/20160408120742114)

不过别急，我们程序员最擅长解决这种问了，再说有什么问题能难倒我聪明的程序员呢

首先我们可以随便打开一个文件，可以查看到时找不到这样的包com.tencent.tauth.IRequestListener，这我们第一反应肯定是，没有加入依赖包，卧槽，真聪明，恭喜你答对了，呵呵~

既然这样那问题就简单了，直接拷贝jar目录下面jar包放到libs，并add path（如果需要），这下整个世界都清净了，错误统统滚开了，现在就可以运行看看效果

### 各种配置

配置权限
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
<!-- SDK2.1新增获取用户位置信息 -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_LOCATION_EXTRA_COMMANDS" />
<uses-permission android:name="android.permission.CHANGE_WIFI_STATE" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="android.permission.READ_PHONE_STATE" />

<uses-permission android:name="android.permission.GET_TASKS"/>
```

配置activity

```xml
<activity
    android:name="com.tencent.tauth.AuthActivity"
    android:launchMode="singleTask"
    android:noHistory="true" >
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />

        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
		
		<!-- 这地方的123456需要用你在开放平台申请的appid替换 -->
        <data android:scheme="tencent123456" />
    </intent-filter>
</activity>

<activity
    android:name="com.tencent.connect.common.AssistActivity"
    android:configChanges="orientation|keyboardHidden"
    android:screenOrientation="behind"
    android:theme="@android:style/Theme.Translucent.NoTitleBar" />
```

到这里我们的清单文件和activity都配置完了，接下来我要实例化Tencent类，所有的操作都是通过他来的，查看demo这个类的实例化是在MainActivity#onCreate方法中，并弄成了单例

```java
public static Tencent mTencent;

if (mTencent == null) {
    mTencent = Tencent.createInstance(mAppid, this);
}
```


### IUiListener
现在我们需要在分享或登录的过程中拿到一些状态，就需要用到IUiListener，调用SDK已经封装好的接口时，例如：登录、快速支付登录、应用分享、应用邀请等接口，需传入该回调的实例。

```java
IUiListener qqShareListener = new IUiListener() {
    @Override
    public void onCancel() {
        if (shareType != QQShare.SHARE_TO_QQ_TYPE_IMAGE) {
            Util.toastMessage(QQShareActivity.this, "onCancel: ");
        }
    }
    @Override
    public void onComplete(Object response) {
        // TODO Auto-generated method stub
        Util.toastMessage(QQShareActivity.this, "onComplete: " + response.toString());
    }
    @Override
    public void onError(UiError e) {
        // TODO Auto-generated method stub
        Util.toastMessage(QQShareActivity.this, "onError: " + e.errorMessage, "e");
    }
};


//如果要收到QQ分享，或登录的一些状态，必须加入代码
@Override
protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    Tencent.onActivityResultData(requestCode,resultCode,data,listener);
}
```



### 分享图片

我这只贴我们今天用到的代码，其他的大家可以直接在demo里面复制，本文主要内容是，记录一些配置，而并不是贴代码

#### 分享到QQ

```java
public void shareOnlyImageOnQQ(View view) {
    final Bundle params = new Bundle();
    params.putString(QQShare.SHARE_TO_QQ_IMAGE_LOCAL_URL, Environment.getExternalStorageDirectory().getAbsolutePath().concat("/a.png"));
    params.putString(QQShare.SHARE_TO_QQ_APP_NAME, "测试应用");
    params.putInt(QQShare.SHARE_TO_QQ_KEY_TYPE, QQShare.SHARE_TO_QQ_TYPE_IMAGE);
//        params.putInt(QQShare.SHARE_TO_QQ_EXT_INT, QQShare.SHARE_TO_QQ_FLAG_QZONE_AUTO_OPEN); //打开这句话，可以实现分享纯图到QQ空间

    doShareToQQ(params);
}



private void doShareToQQ(final Bundle params) {
    // QQ分享要在主线程做
    ThreadManager.getMainHandler().post(new Runnable() {

        @Override
        public void run() {
            if (null != mTencent) {
                mTencent.shareToQQ(QQActivity.this, params, qqShareListener);
            }
        }
    });
}
```

#### 分享到QZONE

截止到2016-4-8，QZONE暂不支持纯图片分享，[官网文档](http://op.open.qq.com/mobile_appinfov2/ability?type=baseAbilityAndroid&appid=1105018490)这里也有说。但是我们可以通过分享到QQ时设置一个参数，就可以直接分享纯图到QQ空间了

```java
public void shareOnlyImageOnQZone(View view) {
    final Bundle params = new Bundle();
    //本地地址一定要传sdcard路径，不要什么getCacheDir()或getFilesDir()
    params.putString(QQShare.SHARE_TO_QQ_IMAGE_LOCAL_URL, Environment.getExternalStorageDirectory().getAbsolutePath().concat("/a.png"));
    params.putString(QQShare.SHARE_TO_QQ_APP_NAME, "测试应用");
    params.putInt(QQShare.SHARE_TO_QQ_KEY_TYPE, QQShare.SHARE_TO_QQ_TYPE_IMAGE);
    params.putInt(QQShare.SHARE_TO_QQ_EXT_INT, QQShare.SHARE_TO_QQ_FLAG_QZONE_AUTO_OPEN); //打开这句话，可以实现分享纯图到QQ空间
    doShareToQQ(params);
}
```

> **注意：这里有个很重要的就是，分享本地图片时路径一定不要传getCacheDir()或getFilesDir()等。不要问我为什么，因为你既然是分享图片到QQ，他要帮我显示，但你给他一个私有目录，他肯定不能显示，那种重点来了，这就到导致很多朋友在做分享时，分享的图片不能显示得原因了。别我是怎么知道的，我说我猜的，你信么~~**


QQ实例完整代码，因为肯定问了，既然上面贴了部分代码，为啥下面还要全贴处理，这你就不懂了吧，上面我只贴了部分，但是他们没多大的关联性，可能不太好理解，而我希望的就是，大家一看看就明白了，不需要再下载demo再在手机上跑一遍，就能解决问题，效果才是王道

```java
package cn.woblog.testthirdpartyfunction.activity;

import android.content.Intent;
import android.os.Bundle;
import android.os.Environment;
import android.support.v7.app.AppCompatActivity;
import android.view.View;

import com.tencent.connect.share.QQShare;
import com.tencent.open.utils.ThreadManager;
import com.tencent.tauth.IUiListener;
import com.tencent.tauth.Tencent;
import com.tencent.tauth.UiError;

import cn.woblog.testthirdpartyfunction.R;
import cn.woblog.testthirdpartyfunction.Util;

public class QQActivity extends AppCompatActivity {

    public static Tencent mTencent;

    private static final String mAppid = "1105245621";


    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_qq);

        if (mTencent == null) {
            mTencent = Tencent.createInstance(mAppid, this);
        }
    }

    public void shareOnlyImageOnQZone(View view) {
        final Bundle params = new Bundle();
        //本地地址一定要传sdcard路径，不要什么getCacheDir()或getFilesDir()
        params.putString(QQShare.SHARE_TO_QQ_IMAGE_LOCAL_URL, Environment.getExternalStorageDirectory().getAbsolutePath().concat("/a.png"));
        params.putString(QQShare.SHARE_TO_QQ_APP_NAME, "测试应用");
        params.putInt(QQShare.SHARE_TO_QQ_KEY_TYPE, QQShare.SHARE_TO_QQ_TYPE_IMAGE);
        params.putInt(QQShare.SHARE_TO_QQ_EXT_INT, QQShare.SHARE_TO_QQ_FLAG_QZONE_AUTO_OPEN); //打开这句话，可以实现分享纯图到QQ空间
        doShareToQQ(params);
    }

    public void shareOnlyImageOnQQ(View view) {
        final Bundle params = new Bundle();
        params.putString(QQShare.SHARE_TO_QQ_IMAGE_LOCAL_URL, Environment.getExternalStorageDirectory().getAbsolutePath().concat("/a.png"));
        params.putString(QQShare.SHARE_TO_QQ_APP_NAME, "测试应用");
        params.putInt(QQShare.SHARE_TO_QQ_KEY_TYPE, QQShare.SHARE_TO_QQ_TYPE_IMAGE);
//        params.putInt(QQShare.SHARE_TO_QQ_EXT_INT, QQShare.SHARE_TO_QQ_FLAG_QZONE_AUTO_OPEN); //打开这句话，可以实现分享纯图到QQ空间

        doShareToQQ(params);
    }


    private void doShareToQQ(final Bundle params) {
        // QQ分享要在主线程做
        ThreadManager.getMainHandler().post(new Runnable() {

            @Override
            public void run() {
                if (null != mTencent) {
                    mTencent.shareToQQ(QQActivity.this, params, qqShareListener);
                }
            }
        });
    }

    IUiListener qqShareListener = new IUiListener() {
        @Override
        public void onCancel() {
            Util.toastMessage(QQActivity.this, "onCancel: ");
        }

        @Override
        public void onComplete(Object response) {
            // TODO Auto-generated method stub
            Util.toastMessage(QQActivity.this, "onComplete: " + response.toString());
        }

        @Override
        public void onError(UiError e) {
            // TODO Auto-generated method stub
            Util.toastMessage(QQActivity.this, "onError: " + e.errorMessage, "e");
        }
    };

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        Tencent.onActivityResultData(requestCode, resultCode, data, qqShareListener);
    }
}

```


## Sina(微博)

我们到[官方文档](https://github.com/sinaweibosdk/weibo_android_sdk)下载相应的[官方demo]()并且多看看项目的ReadeMe，写的很详细让你少走弯路。解压后项目结构如图所示：

![这里写图片描述](http://img.blog.csdn.net/20160408183327217)

如果是第一次集成，我们可以直接运行WeiboSDKDemo_v3.1.4.apk先查看效果，这样也方便你对他的功能和效果有一个大概了解，当如也可以直接导入demo-src目录下面的代码，

>通过这种方式运行工程时，请务必替换默认的 debug.keystore文件，否则无法正确的授权成功。另外，该debug.keysotre 是新浪官方的，除了编译运行官方 DEMO 外，请不要直接使用它，出于安全的考虑，您应该为自己的应用提供一份 keysotre。

在C:\Users\XXXXX\.android目录下，把Android默认的debug.keystore替换成当前微博demo里面提供debug.keystore。

### 配置

在集成微博前，需要到新浪微博官网创建一个应用，在控制台-基本信息菜单里面填上包名和签名，签名通过签名工具获取工具[这里获取](https://github.com/mobileresearch/weibo_android_sdk/blob/master/app_signatures.apk)

![这里写图片描述](http://img.blog.csdn.net/20160408193933458)


配置权限，如果已经添加了相应的权限，就不要重复添加了

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
```

配置返回微博的activity

在进行微博分享前，需要在AndroidManifest.xml中，在需要接收消息的Activity（唤起微博主程序的类）里声明对应的Action：ACTION_SDK_REQ_ACTIVITY，如下所示：
```xml
<!--sina-->
<activity android:name="com.sina.weibo.sdk.component.WeiboSdkBrowser"
          android:configChanges="keyboardHidden|orientation"
          android:windowSoftInputMode="adjustResize"
          android:exported="false" >
</activity>
<service android:name="com.sina.weibo.sdk.net.DownloadService"
         android:exported="false">
</service>

<!--\sina-->

<activity android:name=".activity.QQActivity">
</activity>
<activity android:name=".activity.SinaActivity">
    <!-- 调用新浪原生SDK，需要注册的回调activity -->
    <intent-filter>
        <action android:name="com.sina.weibo.sdk.action.ACTION_SDK_REQ_ACTIVITY" />

        <category android:name="android.intent.category.DEFAULT" />
    </intent-filter>
</activity>
```

### 选择集成sdk方式

在集成微博SDK前，有两种方式来集成微博SDK：

- 直接导入weibosdkcore.jar：适用于只需要授权、分享、网络请求框架功能的项目
- 引用WeiboSDK工程（Library）：适用于微博授权、分享，以及需要登陆按钮、调用OpenAPI的项目

在这里我采用方式1，因为我不需要登录按钮和直接调用OpenAPI


### 分享图片
```java
WeiboMessage weiboMessage = new WeiboMessage();
ImageObject imageObject = new ImageObject();
Bitmap bitmap = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher);
imageObject.setImageObject(bitmap);
weiboMessage.mediaObject = imageObject;
SendMessageToWeiboRequest request = new SendMessageToWeiboRequest();
request.transaction = String.valueOf(System.currentTimeMillis());
request.message = weiboMessage;
mWeiboShareAPI.sendRequest(SinaActivity.this, request);
```

如果配置没问题的话，到这一步已经是可以分享得了，如果遇到什么问题，请在下方评论，我一定会回复的


```java
package cn.woblog.testthirdpartyfunction.activity;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Bundle;
import android.support.v7.app.AppCompatActivity;
import android.view.View;
import android.widget.Toast;

import com.sina.weibo.sdk.api.ImageObject;
import com.sina.weibo.sdk.api.WeiboMessage;
import com.sina.weibo.sdk.api.share.BaseResponse;
import com.sina.weibo.sdk.api.share.IWeiboHandler;
import com.sina.weibo.sdk.api.share.IWeiboShareAPI;
import com.sina.weibo.sdk.api.share.SendMessageToWeiboRequest;
import com.sina.weibo.sdk.api.share.WeiboShareSDK;
import com.sina.weibo.sdk.constant.WBConstants;

import cn.woblog.testthirdpartyfunction.Constants;
import cn.woblog.testthirdpartyfunction.R;

public class SinaActivity extends AppCompatActivity implements IWeiboHandler.Response {


    private IWeiboShareAPI mWeiboShareAPI;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_sina);

        // 创建微博分享接口实例
        mWeiboShareAPI = WeiboShareSDK.createWeiboAPI(this, Constants.APP_KEY);

        // 注册第三方应用到微博客户端中，注册成功后该应用将显示在微博的应用列表中。
        // 但该附件栏集成分享权限需要合作申请，详情请查看 Demo 提示
        // NOTE：请务必提前注册，即界面初始化的时候或是应用程序初始化时，进行注册
        mWeiboShareAPI.registerApp();

        // 当 Activity 被重新初始化时（该 Activity 处于后台时，可能会由于内存不足被杀掉了），
        // 需要调用 {@link IWeiboShareAPI#handleWeiboResponse} 来接收微博客户端返回的数据。
        // 执行成功，返回 true，并调用 {@link IWeiboHandler.Response#onResponse}；
        // 失败返回 false，不调用上述回调
        if (savedInstanceState != null) {
            mWeiboShareAPI.handleWeiboResponse(getIntent(), this);
        }
    }

    public void testShareImage(View view) {
        WeiboMessage weiboMessage = new WeiboMessage();
        ImageObject imageObject = new ImageObject();
        Bitmap bitmap = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher);
        imageObject.setImageObject(bitmap);
        weiboMessage.mediaObject = imageObject;
        SendMessageToWeiboRequest request = new SendMessageToWeiboRequest();
        request.transaction = String.valueOf(System.currentTimeMillis());
        request.message = weiboMessage;
        mWeiboShareAPI.sendRequest(SinaActivity.this, request);
    }


    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);

        // 从当前应用唤起微博并进行分享后，返回到当前应用时，需要在此处调用该函数
        // 来接收微博客户端返回的数据；执行成功，返回 true，并调用
        // {@link IWeiboHandler.Response#onResponse}；失败返回 false，不调用上述回调
        mWeiboShareAPI.handleWeiboResponse(intent, this);
    }

    /**
     * 接收微客户端博请求的数据。
     * 当微博客户端唤起当前应用并进行分享时，该方法被调用。
     *
     * @param baseResp 微博请求数据对象
     * @see {@link IWeiboShareAPI#handleWeiboRequest}
     */
    @Override
    public void onResponse(BaseResponse baseResp) {
        if (baseResp != null) {
            switch (baseResp.errCode) {
                case WBConstants.ErrorCode.ERR_OK:
                    Toast.makeText(this, "success", Toast.LENGTH_LONG).show();
                    break;
                case WBConstants.ErrorCode.ERR_CANCEL:
                    Toast.makeText(this, "cancel", Toast.LENGTH_LONG).show();
                    break;
                case WBConstants.ErrorCode.ERR_FAIL:
                    Toast.makeText(this, "Error Message: " + baseResp.errMsg,
                            Toast.LENGTH_LONG).show();
                    break;
            }
        }
    }
}
```

## 微信

说道微信又不得不吐槽了，要想获得微信登录，还得是企业账户才能申请，还得交钱，你说这叫什么事

![这里写图片描述](http://img.blog.csdn.net/20160411100009260)

首先我打开微信开发者官网，注册个账号或者用已有的账号登录，在管理中心创建应用并提交审核，审完完成如下图。

![这里写图片描述](http://img.blog.csdn.net/20160411100219226)

可以看到我们已经获得，分享到朋友圈或朋友的权限，微信登录等还需要申请，那我现在只有先测试分享了

首先我们来到[开发者官网文档](https://open.weixin.qq.com/cgi-bin/showdocument?action=dir_list&t=resource/res_list&verify=1&lang=zh_CN)下载相应的sdk和开发文档

![这里写图片描述](http://img.blog.csdn.net/20160411100652326)

这其中我只下载了如下sdk

![这里写图片描述](http://img.blog.csdn.net/20160411100911751)

第一个是：获取签名的，不过我感觉不太好用，因为他没有复制签名的按钮，每次还得照着一个一个打出来，我推荐用[微博的签名工具](https://github.com/mobileresearch/weibo_android_sdk/blob/master/app_signatures.apk)

第二个是：使用微信分享、登录、收藏、支付等功能需要的库以及文件

第三个是：范例代码，包含了一个完整的范例工程。该范例的使用可以参阅Android平台上手指南

首先我们用eclipse导入示例代码，替换当前目录下的keystore，然后运行就可以查看相关示例

下面我们就应该来安装官方文档来集成sdk了

首先在官网创建一个应用，获取到AppId，然后把刚刚下载的sdk包里面的libammsdk.jar拷贝到你的项目libs目录下，并添加到path（如果需要）

配置权限：

说到这里，有的吐槽了，你看看这个排版，简直是差评

![这里写图片描述](http://img.blog.csdn.net/20160411103909166)

在看看我们下面的代码，这排版，这样是，一看就是很帅的人写的~~

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE"/>
<uses-permission android:name="android.permission.READ_PHONE_STATE"/>
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"/>
```

配置activity

由于我们要接受微信分享的一些信息，比如：分享成功或失败

这一步很重要，配置错误将收不到消息，在你的包名根目录下创建wxapi包，然后在该包下创建activity命名为WXEntryActivity并实现IWXAPIEventHandler接口，基本代码如下：

```java
package cn.woblog.testthirdpartyfunction.wxapi;

import android.os.Bundle;
import android.support.v7.app.AppCompatActivity;

import com.tencent.mm.sdk.openapi.BaseReq;
import com.tencent.mm.sdk.openapi.BaseResp;
import com.tencent.mm.sdk.openapi.IWXAPIEventHandler;

import cn.woblog.testthirdpartyfunction.R;

public class WXEntryActivity extends AppCompatActivity implements IWXAPIEventHandler {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_wxentry);
    }
    // 微信发送请求到第三方应用时，会回调到该方法
    @Override
    public void onReq(BaseReq baseReq) {

    }
    // 第三方应用发送到微信的请求处理后的响应结果，会回调到该方法
    @Override
    public void onResp(BaseResp baseResp) {

    }
}
```

载清单文件里配置你的activity

```xml
<activity android:name=".wxapi.WXEntryActivity" android:exported="true">
</activity>
```

创建实例，并注册到微信

```java
 @Override
protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(R.layout.activity_wxentry);

    //如果分享的时候，该界面没有开启，那么微信开始这个activity时，会调用onCreate，所以这里要处理微信的返回结果
    WxActivity.api.handleIntent(getIntent(), this);
}

@Override
protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    //如果分享的时候，该已经开启，那么微信开始这个activity时，会调用onNewIntent，所以这里要处理微信的返回结果
    setIntent(intent);
    WxActivity.api.handleIntent(intent, this);
}

```

### 分享图片

```java
/**
 * @param isShareFriend true 分享到朋友，false分享到朋友圈
 */
private void share2Wx(boolean isShareFriend) {
    Bitmap bitmap = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher);
    WXImageObject imgObj = new WXImageObject(bitmap);

    WXMediaMessage msg = new WXMediaMessage();
    msg.mediaObject = imgObj;
    Bitmap thumbBmp = Bitmap.createScaledBitmap(bitmap, THUMB_SIZE, THUMB_SIZE, true);//缩略图大小
    bitmap.recycle();
    msg.thumbData = Util.bmpToByteArray(thumbBmp, true);  // 设置缩略图

    SendMessageToWX.Req req = new SendMessageToWX.Req();
    req.transaction = buildTransaction("img");
    req.message = msg;
    req.scene = isShareFriend ? SendMessageToWX.Req.WXSceneSession : SendMessageToWX.Req.WXSceneTimeline;
    api.sendReq(req);
}
```

#### 朋友

这里就简单了，直接调用上面的方法
share2Wx(true);
#### 朋友圈
```java
share2Wx(false);
```


这里是这个分享的完整代码

```java
package cn.woblog.testthirdpartyfunction.activity;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Bundle;
import android.support.v7.app.AppCompatActivity;
import android.view.View;

import com.tencent.mm.sdk.openapi.IWXAPI;
import com.tencent.mm.sdk.openapi.SendMessageToWX;
import com.tencent.mm.sdk.openapi.WXAPIFactory;
import com.tencent.mm.sdk.openapi.WXImageObject;
import com.tencent.mm.sdk.openapi.WXMediaMessage;
import com.tencent.mm.sdk.platformtools.Util;

import cn.woblog.testthirdpartyfunction.Constants;
import cn.woblog.testthirdpartyfunction.R;

public class WxActivity extends AppCompatActivity {
    private static final int THUMB_SIZE = 150;

    public static IWXAPI api;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_wx);

        // 通过WXAPIFactory工厂，获取IWXAPI的实例
        api = WXAPIFactory.createWXAPI(this, Constants.WX_APP_ID, false);
        // 将该app注册到微信
        api.registerApp(Constants.WX_APP_ID);
    }

    /**
     * 分享一张图片到朋友
     *
     * @param view
     */
    public void testShareImage2friend(View view) {
        share2Wx(true);
    }

    /**
     * 分享一张图片到朋友圈
     *
     * @param view
     */
    public void testShareImage2friends(View view) {
        share2Wx(false);
    }

    /**
     * @param isShareFriend true 分享到朋友，false分享到朋友圈
     */
    private void share2Wx(boolean isShareFriend) {
        Bitmap bitmap = BitmapFactory.decodeResource(getResources(), R.mipmap.ic_launcher);
        WXImageObject imgObj = new WXImageObject(bitmap);

        WXMediaMessage msg = new WXMediaMessage();
        msg.mediaObject = imgObj;
        Bitmap thumbBmp = Bitmap.createScaledBitmap(bitmap, THUMB_SIZE, THUMB_SIZE, true);//缩略图大小
        bitmap.recycle();
        msg.thumbData = Util.bmpToByteArray(thumbBmp, true);  // 设置缩略图

        SendMessageToWX.Req req = new SendMessageToWX.Req();
        req.transaction = buildTransaction("img");
        req.message = msg;
        req.scene = isShareFriend ? SendMessageToWX.Req.WXSceneSession : SendMessageToWX.Req.WXSceneTimeline;
        api.sendReq(req);
    }

    private String buildTransaction(final String type) {
        return (type == null) ? String.valueOf(System.currentTimeMillis()) : type + System.currentTimeMillis();
    }
}
```

另外说点题外话，鉴于我是有点强迫症的人，所以在代码以及文字的组织和代码的格式化都保持良好的风格，特别是代码的格式，我都是每次先自己写一遍，然后在从开发工具里拷贝出来，有时还得按tad一点一点点缩进（如果哪位大神有更好的方法，希望指教下），才贴到这上面了，以为我觉得既然要写博客就要写好，这要才对别人有帮助，在我觉得如果文字排版或者代码格式乱乱的，就是耍流氓。

![这里写图片描述](http://img.blog.csdn.net/20160408195341890)

### 混淆

这里是个坑，相信很多朋友都在这里遇到了"虽然弹出了选择好友，但点击没反应的问题"这个是没有在混淆里面排除微信的相关包，感谢[@Bemyself](http://t.qq.com/q844258542)同学的评论，在你的混淆文件中添加：

```
-keep class com.tencent.mm.sdk.** {
   *;
}
```

以上测试的代码我放到[github](https://github.com/lifengsofts/TestThirdPartyFunction/tree/master)了，有什么问题可以直接评论或者在github上创建issure

如果我的文章对来带来的帮助，可加我微信，微博，QQ什么啥的交个朋友也是不错的，另外微信，微博都会不定期发一些优质的文章，感谢大家的支持~~