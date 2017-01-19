---
title: 如何借助工具改善Java代码的质量
date: 2017-01-17 18:04:59
categories: Java
tags: 
    - Java
---

# findBugs

## 简介

他是一个静态分析工具(分析的是class)，能帮你找出代码中一些潜在问题，比如：空指针，编程不好的习惯等问题。

## idea

在idea中可以安装FindBugs-IDEA插件，来可视化操作，安装完成后可以选择要分析的目录右键就可以看到FindBugs。

## gradle

可以将findbug集成到gradle的构建任务中，就可以方便的实现，在持续集成中使用它的报告

## 添加依赖

在你要添加的module的build.gradle的文件中添加

```groovy
apply plugin: 'findbugs'
```

然后在build.gradle文件中添加一个任务

```groovy
afterEvaluate {
    task findbugs(type: FindBugs, dependsOn: assembleDebug) {

        description 'Run findbugs'
        group 'verification'

        //被分析的类路径
        classes = fileTree("$project.buildDir/intermediates/classes/debug/")

        //源代码目录
        source = fileTree('src/main/java')
        classpath = project.configurations.compile

        effort = 'max'

        //规则文件
        excludeFilter = file("findbugs-exclude.xml")

        reports {
            xml.enabled = false
            html.enabled = true

//            xml {
//                destination "$project.buildDir/findbugs.xml"
//            }
//            html {
//                destination "$project.buildDir/findbugs.html"
//            }
        }
    }

    //动态添加到check任务的依赖上
    check.dependsOn('findbugs')
}
```

官方文档地址：https://docs.gradle.org/current/dsl/org.gradle.api.plugins.quality.FindBugs.html，可以看到每个方法的作用

### 规则

http://blog.csdn.net/jdsjlzx/article/details/21472253/

# checkstyle

他是用来根据一些代码的风格文件来检查代码格式。在java代码中常用的编码风格有[google-style](https://github.com/google/styleguide)。他能检查的范围包括：

.Javadoc注释
·命名约定
·标题
·Import语句
·体积大小
·空白
·修饰符
·块
·代码问题
·类设计
·混合检查（包括一些有用的比如非必须的System.out和printstackTrace）

## gradle

### 添加依赖

```
apply plugin: 'checkstyle'
```

然后添加一个任务

```groovy
task checkstyle(type: Checkstyle) {
    configFile file("${project.rootDir}/checkstyle.xml")
    configProperties.checkstyleSuppressionsPath = file("${project.rootDir}/suppressions.xml").absolutePath
    source 'src'
    include '**/*.java'
    exclude '**/gen/**'
    classpath = files()
}

check.dependsOn('checkstyle')
```

然后在指定版本

```groovy
checkstyle {
    toolVersion = 6.12.1
}
```

然后添加规则文件

checkstyle.xml

```groovy
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE module PUBLIC "-//Puppy Crawl//DTD Check Configuration 1.3//EN" "http://www.puppycrawl.com/dtds/configuration_1_3.dtd">
<module name="Checker">
    <module name="FileLength"/>
    <module name="FileTabCharacter"/>

    <!--<module name="SuppressionFilter">-->
        <!--<property name="file" value="${checkStyleConfigDir}/checkstyle_suppressions.xml" />-->
    <!--</module>-->

    <!-- Trailing spaces -->
    <module name="RegexpSingleline">
        <property name="format" value="\s+$"/>
        <property name="message" value="Line has trailing spaces."/>
    </module>

    <!-- Ensure trailling newline for compatibility -->
    <module name="NewlineAtEndOfFile" />

    <!-- Space after 'for' and 'if' -->
    <module name="RegexpSingleline">
        <property name="format" value="^\s*(for|if)\b[^ ]"/>
        <property name="message" value="Space needed before opening parenthesis."/>
    </module>

    <!-- For each spacing -->
    <module name="RegexpSingleline">
        <property name="format" value="^\s*for \(.*?([^ ]:|:[^ ])"/>
        <property name="message" value="Space needed around ':' character."/>
    </module>

    <module name="TreeWalker">
        <!-- Checks for uncommented main() methods (debugging leftovers). -->
        <!-- Checks that long constants are defined with an upper ell. -->
        <!-- See http://checkstyle.sourceforge.net/config_misc.html#UpperEll -->
        <module name="UpperEll" />

        <!-- Checks the style of array type definitions. -->
        <!-- See http://checkstyle.sourceforge.net/config_misc.html#ArrayTypeStyle -->
        <module name="ArrayTypeStyle" />

        <!-- Checks that the outer type name and the file name match. -->
        <!-- See http://checkstyle.sourceforge.net/config_misc.html#OuterTypeFilename -->
        <module name="OuterTypeFilename" />

        <!-- Validates Javadoc comments to help ensure they are well formed. -->
        <!-- See http://checkstyle.sourceforge.net/config_javadoc.html#JavadocStyle -->
        <module name="JavadocStyle" />
        <module name="JavadocType">
            <property name="scope" value="public"/>
        </module>

        <!-- Each of these naming modules validates identifiers for particular
                code elements. -->
        <!-- See http://checkstyle.sourceforge.net/config_naming.html -->
        <module name="ConstantName">
            <property name="format" value="^[A-Z][A-Z0-9\$]*(_[A-Z0-9\$]+)*$" />
        </module>
        <module name="LocalFinalVariableName" />
        <module name="LocalVariableName" />
        <module name="MemberName">
            <property name="format" value="^[a-z][a-zA-Z0-9_\$]*$" />
        </module>
        <module name="MethodName" >
            <property name="format" value="^[a-z][a-zA-Z0-9]*(_[a-zA-Z0-9]+)*$"/>
        </module>
        <module name="PackageName" />
        <module name="ParameterName" />
        <module name="StaticVariableName" />
        <module name="TypeName" />

        <module name="TrailingComment" />

        <!-- Checks for imports. -->
        <!-- See http://checkstyle.sourceforge.net/config_imports.html -->
        <module name="AvoidStarImport"/>
        <module name="RedundantImport"/>
        <module name="UnusedImports"/>
        <!-- Default sun.* packages -->
        <module name="IllegalImport">
            <property name="illegalPkgs" value="sun" />
            <message key="import.illegal" value="Import from illegal package - {0}. Programs that contain direct calls to the sun.* packages are not 100% Pure Java." />
        </module>
        <!-- Prevent importing JUnit 3 classes and Assert methods -->
        <module name="IllegalImport">
            <property name="illegalPkgs" value="junit" />
            <message key="import.illegal" value="Import from illegal package - {0}. Tests are written in JUnit 4, use org.junit.* equivalents." />
        </module>
        <!-- Prevent importing Mockito matchers directly -->
        <module name="IllegalImport">
            <property name="illegalPkgs" value="org.mockito.internal" />
            <message key="import.illegal" value="Import from illegal package - {0}. Use org.mockito.Matchers to instantiate argument matchers; or org.hamcrest.Matchers for assertThat." />
        </module>
        <module name="ImportOrder">
            <!-- Checks for out of order import statements. -->

            <property name="sortStaticImportsAlphabetically" value="true"/>
            <property name="severity" value="error"/>
            <property name="groups" value="*"/>
            <!-- This ensures that static imports go first. -->
            <property name="option" value="top"/>
            <property name="tokens" value="STATIC_IMPORT, IMPORT"/>
        </module>

        <!-- Checks for whitespace. -->
        <!-- See http://checkstyle.sourceforge.net/config_whitespace.html -->
        <module name="GenericWhitespace" />
        <module name="MethodParamPad" />
        <module name="NoWhitespaceAfter">
            <property name="tokens"
                value="BNOT, DEC, DOT, INC, LNOT, UNARY_MINUS, UNARY_PLUS" />
        </module>
        <module name="NoWhitespaceBefore" />
        <module name="OperatorWrap" />
        <module name="ParenPad" />
        <module name="TypecastParenPad" />
        <module name="WhitespaceAfter" />
        <module name="WhitespaceAround" />


        <!-- Modifier Checks. -->
        <!-- See http://checkstyle.sourceforge.net/config_modifier.html -->
        <module name="ModifierOrder" />

        <!-- Checks for blocks. -->
        <!-- See http://checkstyle.sourceforge.net/config_blocks.html -->
        <module name="AvoidNestedBlocks" />
        <module name="EmptyBlock" >
            <property name="option" value="text"/>
        </module>
        <module name="NeedBraces"/>

        <module name="LeftCurly" />
        <module name="RightCurly">
            <property name="tokens"
                value="LITERAL_TRY, LITERAL_CATCH, LITERAL_FINALLY, LITERAL_ELSE" />
        </module>

        <!-- Checks for common coding problems. -->
        <!-- See http://checkstyle.sourceforge.net/config_coding.html -->
        <module name="CovariantEquals" />
        <module name="DefaultComesLast" />
        <module name="EmptyStatement" />
        <module name="EqualsHashCode" />
        <module name="NoClone" />
        <module name="NoFinalizer" />
        <module name="OneStatementPerLine" />
        <module name="IllegalInstantiation"/>
        <module name="SimplifyBooleanExpression" />
        <module name="SimplifyBooleanReturn" />
        <module name="StringLiteralEquality" />
        <module name="UnnecessaryParentheses" />
        <module name="LineLength">
            <property name="max" value="100" />
        </module>

        <!-- Checks for class design. -->
        <!-- See http://checkstyle.sourceforge.net/config_design.html -->
        <module name="FinalClass" />
        <module name="InterfaceIsType" />
    </module>
</module>
```

checkstyle_suppressions.xml

```
<?xml version="1.0"?>

<!DOCTYPE suppressions PUBLIC
    "-//Puppy Crawl//DTD Suppressions 1.1//EN"
    "http://www.puppycrawl.com/dtds/suppressions_1_1.dtd">

<suppressions>
    <suppress files=".*[/\\]library[/\\]src[/\\]test[/\\].*" checks="Javadoc.*"/>
    <suppress files=".*[/\\]gif_encoder[/\\].*" checks=".*"/>
    <suppress files=".*RequestBuilder.java|ChildLoadProvider.java|TransitionOptions.java|BaseDecodeOptions.java|RequestOptions.java" checks="NoClone" />
</suppressions>
```

然后就可以执行

```shell
./gradlew checkstyle
```



文件规则：http://www.blogjava.net/amigoxie/archive/2014/05/31/414287.html

官方主页：https://github.com/checkstyle/checkstyle

报错规则：http://blog.csdn.net/jzy23682891/article/details/7057978

http://blog.csdn.net/simon_world/article/details/40249827

## idea

可以安装checkstyle-idea插件来可视化检查代码的问题https://github.com/jshiell/checkstyle-idea

插件仓库地址：https://plugins.jetbrains.com/idea/plugin/1065-checkstyle-idea

安装完成后可以在偏好设置-其他设置里面找到checkstyle的设置，然后新建一个配置，选择项目中的checkstyle.xml，然后点击前面的复选框启动它。

然后可以在editor-inspections-checkstyle开关checkstyle是否实时检查代码，但是我这里试了好像没法实时检查。但是可以在下方的checkstyle菜单栏中使用手动检查。

我们还有小需求就是，使用自定义的格式来格式化代码，我们这里加入[googlestyle-java](https://github.com/google/styleguide/blob/gh-pages/eclipse-java-google-style.xml)。将他下载到本地。

然后在editor-code style-java-manager里面导入下载的文件，类型选择idea code style xml。当然也可以选择项目中的checkstyle文件。

然后使用idea格式化代码的菜单，就可以使用自定义文件格式化代码。

# pmd

他和findbugs差不多，但是他是检测源代码。

http://pmd.github.io

## gradle

添加依赖

```groovy
apply plugin: 'pmd'
```

然后在添加任务

```groovy
task pmd(type: Pmd) {
    description 'Run pmd'
    group 'verification'

    // If ruleSets is not empty, it seems to contain some
    // defaults which override rules in the ruleset file...
    ignoreFailures = false
    ruleSets = []
    ruleSetFiles = files('pmd-ruleset.xml')

    source 'src'
    include '**/*.java'
    exclude '**/gen/**'

    reports {
        xml.enabled = false
        html.enabled = true
    }

}

check.dependsOn('pmd')
```

接下来添加规则文件

pmd-ruleset.xml

```xml
<?xml version="1.0"?>
<!--
  ~ Copyright 2015 Vincent Brison.
  ~
  ~ Licensed under the Apache License, Version 2.0 (the "License");
  ~ you may not use this file except in compliance with the License.
  ~ You may obtain a copy of the License at
  ~
  ~    http://www.apache.org/licenses/LICENSE-2.0
  ~
  ~ Unless required by applicable law or agreed to in writing, software
  ~ distributed under the License is distributed on an "AS IS" BASIS,
  ~ WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  ~ See the License for the specific language governing permissions and
  ~ limitations under the License.
  -->

<ruleset xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" name="Android Application Rules"
  xmlns="http://pmd.sf.net/ruleset/1.0.0"
  xsi:noNamespaceSchemaLocation="http://pmd.sf.net/ruleset_xml_schema.xsd"
  xsi:schemaLocation="http://pmd.sf.net/ruleset/1.0.0 http://pmd.sf.net/ruleset_xml_schema.xsd">

  <description>Custom ruleset for Android application</description>

  <exclude-pattern>.*/R.java</exclude-pattern>
  <exclude-pattern>.*/gen/.*</exclude-pattern>

  <rule ref="rulesets/java/android.xml" />
  <rule ref="rulesets/java/clone.xml" />
  <rule ref="rulesets/java/finalizers.xml" />
  <rule ref="rulesets/java/imports.xml">
    <!-- Espresso is designed this way !-->
    <exclude name="TooManyStaticImports" />
  </rule>
  <rule ref="rulesets/java/logging-java.xml" />
  <rule ref="rulesets/java/braces.xml" />
  <rule ref="rulesets/java/strings.xml" />
  <rule ref="rulesets/java/basic.xml" />
  <rule ref="rulesets/java/naming.xml">
    <exclude name="AbstractNaming" />
    <exclude name="LongVariable" />
    <exclude name="ShortMethodName" />
    <exclude name="ShortVariable" />
    <exclude name="VariableNamingConventions" />
  </rule>
</ruleset>
```

规则文件：http://blog.csdn.net/tanxiang21/article/details/8425448

然后执行./gradlew pmd

# jacoco

java代码覆盖率工具http://www.eclemma.org/jacoco/

这两篇文章说的都很详细，但是这是在eclipse中：

http://www.ibm.com/developerworks/cn/java/j-lo-jacoco/

http://blog.csdn.net/wangmuming/article/details/23455947

### idea

默认就可以测试代码的覆盖率，可以选择一个测试Run → Edit Configurations里更改测试引擎。然后选择测试右键可以看到run * with coverage菜单。

## gradle

官方文档：https://docs.gradle.org/current/userguide/jacoco_plugin.html

参考：http://www.open-open.com/lib/view/open1473301228051.html

### 添加依赖

```groovy
apply plugin: 'jacoco'
```

然后配置版本

```groovy
jacoco {
    toolVersion = "0.7.1.201405082137"
}
```

最后在debug中开启他

```groovy
debug {
    testCoverageEnabled = true
}
```

然后就会添加一个createDebugCoverageReport任务，我执行就行了。然后在输出目录就可以看到测试报告了。但是我在这里试了，查看报告并都是0%。





















